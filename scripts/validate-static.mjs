import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'index.html',
  'styles.css',
  'audit-report.md',
  'roadmap-report.md',
  'src/app.js',
  'src/client.js',
  'src/domain.js',
  'src/roadmap.js',
  'src/config.example.js',
];

await Promise.all(requiredFiles.map((file) => access(file)));

const html = await readFile('index.html', 'utf8');
const config = await readFile('src/config.example.js', 'utf8');
const report = await readFile('audit-report.md', 'utf8');
const roadmap = await readFile('roadmap-report.md', 'utf8');

if (!html.includes('<main') || !html.includes('Рабочее пространство') || !html.includes('roadmap-workspace') || !html.includes('src/app.js')) {
  throw new Error('index.html must include the semantic application shell.');
}

if (!config.includes('SUPABASE_ANON_KEY') || /service[_-]?role/i.test(config)) {
  throw new Error('The configuration example must contain public anonymous access only.');
}

if (!report.startsWith('# Технический аудит') || !report.includes('## Приложение. Проверено в рантайме')) {
  throw new Error('The complete static audit report must be available to the client.');
}

if (!roadmap.startsWith('# Стратегия развития сайта «Сладкий Град»') || !roadmap.includes('## 6. Предлагаемый порядок работ (3 итерации)')) {
  throw new Error('The complete static roadmap source document must be available to the client.');
}

console.log('Static foundation validated.');
