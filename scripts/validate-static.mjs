import { access, readFile } from 'node:fs/promises';

const requiredFiles = ['index.html', 'src/domain.js', 'src/config.example.js'];

await Promise.all(requiredFiles.map((file) => access(file)));

const html = await readFile('index.html', 'utf8');
const config = await readFile('src/config.example.js', 'utf8');

if (!html.includes('<main') || !html.includes('Primary navigation')) {
  throw new Error('index.html must include the semantic application shell.');
}

if (!config.includes('SUPABASE_ANON_KEY') || /service[_-]?role/i.test(config)) {
  throw new Error('The configuration example must contain public anonymous access only.');
}

console.log('Static foundation validated.');
