import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const template = fileURLToPath(new URL('./sw.template.js', import.meta.url));
const CACHEABLE = /\.(html|css|js|json|webmanifest|svg|png|woff2)$/;

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else out.push(relative(root, path).split(sep).join('/'));
  }
  return out;
}

export async function stampedServiceWorker() {
  const source = await readFile(template, 'utf8');
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const files = (await listFiles(root)).filter((p) => p !== 'sw.js' && CACHEABLE.test(p)).sort();
  const hash = createHash('sha256');
  for (const p of files) hash.update(p).update(await readFile(join(root, p)));
  const shell = ['./', ...files].map((p) => `  '${p}',`).join('\n');
  return source
    .replace(/const RELEASE = '[^']*';/, `const RELEASE = '${version}';`)
    .replace(/const VERSION = '[^']*';/, `const VERSION = 'sembilan-${hash.digest('hex').slice(0, 12)}';`)
    .replace(/const SHELL = \[[^\]]*\];/, `const SHELL = [\n${shell}\n];`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(join(root, 'sw.js'), await stampedServiceWorker());
}
