import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'styles.css',
  'audit-report.md',
  'src/app.js',
  'src/client.js',
  'src/domain.js',
  'src/config.example.js',
];

await Promise.all(requiredFiles.map((file) => access(file)));

const html = await readFile('index.html', 'utf8');
const config = await readFile('src/config.example.js', 'utf8');
const report = await readFile('audit-report.md', 'utf8');

if (!html.includes('<main') || !html.includes('Primary navigation') || !html.includes('src/app.js')) {
  throw new Error('index.html must include the semantic application shell.');
}

if (!config.includes('SUPABASE_ANON_KEY') || /service[_-]?role/i.test(config)) {
  throw new Error('The configuration example must contain public anonymous access only.');
}

if (!report.startsWith('# Технический аудит') || !report.includes('## Приложение. Проверено в рантайме')) {
  throw new Error('The complete static audit report must be available to the client.');
}

console.log('Static foundation validated.');
