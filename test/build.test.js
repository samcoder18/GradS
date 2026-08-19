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

    expect(workflow).toMatch(/uses:\s*actions\/configure-pages@v\d+/);
    expect(workflow).toMatch(/uses:\s*actions\/upload-pages-artifact@v\d+/);
    expect(workflow).toMatch(/uses:\s*actions\/deploy-pages@v\d+/);
    expect(workflow).toMatch(/npm ci/);
    expect(workflow).toMatch(/npm test/);
    expect(workflow).toMatch(/npm run build/);
    expect(workflow).toMatch(/path:\s*dist/);
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

      expect(rootFiles.sort()).toEqual(['audit-report.md', 'index.html', 'src', 'styles.css']);
      expect(sourceFiles.sort()).toEqual(['app.js', 'client.js', 'config.js', 'domain.js']);
      expect(config).toContain('SUPABASE_URL = "https://audit-project.supabase.co"');
      expect(config).toContain('SUPABASE_ANON_KEY = "public-anon-key"');
      expect(config).not.toMatch(/service[_-]?role|SUPABASE_DB_URL/i);
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
});
