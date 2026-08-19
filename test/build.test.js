import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';

const execFileAsync = promisify(execFile);
const projectRoot = new URL('..', import.meta.url).pathname;
const buildScript = new URL('../scripts/build.mjs', import.meta.url).pathname;

function buildEnvironment(outputDirectory, extra = {}) {
  return {
    ...process.env,
    BUILD_DIR: outputDirectory,
    SUPABASE_URL: 'https://audit-project.supabase.co',
    SUPABASE_ANON_KEY: 'public-anon-key',
    ...extra,
  };
}

describe('deployment build', () => {
  test('GitHub Pages workflow tests and uploads the generated runtime artifact', async () => {
    const workflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
    const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    const supabaseConfig = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
    const databaseTest = await readFile(new URL('../supabase/tests/database.test.sql', import.meta.url), 'utf8');

    expect(workflow).toMatch(/permissions:\s*[\s\S]*pages:\s*write[\s\S]*id-token:\s*write/);
    expect(workflow).toMatch(/concurrency:\s*[\s\S]*group:\s*github-pages/);
    expect(workflow).toMatch(/SUPABASE_URL:\s*\$\{\{ vars\.SUPABASE_URL \}\}/);
    expect(workflow).toMatch(/SUPABASE_ANON_KEY:\s*\$\{\{ vars\.SUPABASE_ANON_KEY \}\}/);
    expect(workflow).toMatch(/uses:\s*actions\/configure-pages@v\d+/);
    expect(workflow).toMatch(/uses:\s*actions\/upload-pages-artifact@v\d+/);
    expect(workflow).toMatch(/uses:\s*actions\/deploy-pages@v\d+/);
    expect(workflow).toMatch(/npm ci/);
    expect(workflow).toMatch(/npm test/);
    expect(workflow).toMatch(/npm run build/);
    expect(workflow).toMatch(/uses:\s*actions\/upload-pages-artifact@v\d+[\s\S]*?with:\s*\n\s*path:\s*dist\s*$/m);
    expect(workflow).toMatch(/database-tests:[\s\S]*uses:\s*supabase\/setup-cli@v2/);
    expect(workflow).toMatch(/database-tests:[\s\S]*version:\s*2\.84\.2/);
    expect(workflow).toMatch(/database-tests:[\s\S]*supabase db start[\s\S]*npm run test:db/);
    expect(workflow).toMatch(/deploy:[\s\S]*needs:\s*\[build, database-tests\]/);
    expect(packageJson.scripts['test:db']).toBe('supabase test db');
    expect(supabaseConfig).toMatch(/project_id\s*=\s*"audit-tracker"/);
    expect(supabaseConfig).toMatch(/major_version\s*=\s*17/);
    expect(databaseTest).toContain('select plan(55);');
    expect(databaseTest).toContain('select * from finish();');
  });

  test('emits only runtime assets and a public generated configuration', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'audit-tracker-build-'));

    try {
      await execFileAsync(process.execPath, [buildScript], {
        cwd: projectRoot,
        env: buildEnvironment(outputDirectory),
      });

      const rootFiles = await readdir(outputDirectory);
      const sourceFiles = await readdir(join(outputDirectory, 'src'));
      const config = await readFile(join(outputDirectory, 'src/config.js'), 'utf8');
      const html = await readFile(join(outputDirectory, 'index.html'), 'utf8');
      const client = await readFile(join(outputDirectory, 'src/client.js'), 'utf8');

      expect(rootFiles.sort()).toEqual(['audit-report.md', 'index.html', 'src', 'styles.css']);
      expect(sourceFiles.sort()).toEqual(['app.js', 'client.js', 'config.js', 'domain.js']);
      expect(config).toContain('SUPABASE_URL = "https://audit-project.supabase.co"');
      expect(config).toContain('SUPABASE_ANON_KEY = "public-anon-key"');
      expect(config).not.toMatch(/service[_-]?role|SUPABASE_DB_URL/i);
      expect(html).not.toMatch(/<script[^>]+type=["']importmap["'][^>]*>/i);
      expect(html).not.toMatch(/<script[^>]+src=["']https?:\/\//i);
      expect(html).not.toContain('esm.sh');
      expect(client).not.toMatch(/from\s+['"]@supabase\/supabase-js|https?:\/\//);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });

  test('fails before publishing an artifact when public configuration is absent', async () => {
    const outputDirectory = join(await mkdtemp(join(tmpdir(), 'audit-tracker-build-')), 'dist');

    try {
      await expect(execFileAsync(process.execPath, [buildScript], {
        cwd: projectRoot,
        env: buildEnvironment(outputDirectory, {
          SUPABASE_URL: '',
          SUPABASE_ANON_KEY: '',
        }),
      })).rejects.toMatchObject({
        stderr: expect.stringContaining('Missing public build configuration'),
      });
    } finally {
      await rm(join(outputDirectory, '..'), { recursive: true, force: true });
    }
  });

  test.each([
    { SUPABASE_URL: '', SUPABASE_ANON_KEY: 'public-anon-key' },
    { SUPABASE_URL: 'https://audit-project.supabase.co', SUPABASE_ANON_KEY: '' },
    { SUPABASE_URL: 'http://audit-project.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key' },
  ])('rejects unusable public configuration: %o', async (variables) => {
    const outputDirectory = join(await mkdtemp(join(tmpdir(), 'audit-tracker-build-')), 'dist');

    try {
      await expect(execFileAsync(process.execPath, [buildScript], {
        cwd: projectRoot,
        env: buildEnvironment(outputDirectory, variables),
      })).rejects.toMatchObject({ stderr: expect.stringMatching(/Missing public build configuration|valid HTTPS URL/) });
    } finally {
      await rm(join(outputDirectory, '..'), { recursive: true, force: true });
    }
  });

  test('serializes generated public configuration without executable interpolation', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'audit-tracker-build-'));
    const url = 'https://audit-project.supabase.co/path?label="quoted"';
    const anonKey = 'public\\key\nwith "quotes"';

    try {
      await execFileAsync(process.execPath, [buildScript], {
        cwd: projectRoot,
        env: buildEnvironment(outputDirectory, { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey }),
      });

      const config = await readFile(join(outputDirectory, 'src/config.js'), 'utf8');
      const generated = await import(`${new URL(`file://${join(outputDirectory, 'src/config.js')}`).href}?cacheBust=${Date.now()}`);

      expect(config).toContain(JSON.stringify(url));
      expect(config).toContain(JSON.stringify(anonKey));
      expect(generated.SUPABASE_URL).toBe(url);
      expect(generated.SUPABASE_ANON_KEY).toBe(anonKey);
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  });
});
