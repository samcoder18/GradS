import { access, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const runtimeFiles = [
  'index.html',
  'styles.css',
  'roadmap-report.md',
  'src/app.js',
  'src/client.js',
  'src/domain.js',
  'src/roadmap.js',
];

function publicConfiguration(environment = process.env) {
  const url = environment.SUPABASE_URL?.trim();
  const anonKey = environment.SUPABASE_ANON_KEY?.trim();
  const missing = [
    !url && 'SUPABASE_URL',
    !anonKey && 'SUPABASE_ANON_KEY',
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(`Missing public build configuration: ${missing.join(', ')}. Set GitHub repository variables before deploying.`);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
  }

  return { url, anonKey };
}

async function prepareOutputDirectory(outputDirectory) {
  if (process.env.BUILD_DIR) {
    await mkdir(outputDirectory, { recursive: true });
    const existing = await readdir(outputDirectory);
    if (existing.length) {
      throw new Error(`BUILD_DIR must be empty: ${outputDirectory}`);
    }
    return;
  }

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
}

async function copyRuntimeFiles(outputDirectory) {
  await Promise.all(runtimeFiles.map(async (file) => {
    await access(file);
    const destination = resolve(outputDirectory, file);
    await mkdir(resolve(destination, '..'), { recursive: true });
    await copyFile(file, destination);
  }));
}

async function main() {
  const configuration = publicConfiguration();
  const outputDirectory = resolve(process.env.BUILD_DIR || 'dist');

  await import('./validate-static.mjs');
  await prepareOutputDirectory(outputDirectory);
  await copyRuntimeFiles(outputDirectory);
  await writeFile(
    resolve(outputDirectory, 'src/config.js'),
    `// Generated at build time. These Supabase browser credentials are intentionally public.\nexport const SUPABASE_URL = ${JSON.stringify(configuration.url)};\nexport const SUPABASE_ANON_KEY = ${JSON.stringify(configuration.anonKey)};\n`,
    'utf8',
  );

  console.log(`Deployment artifact created in ${outputDirectory}.`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
