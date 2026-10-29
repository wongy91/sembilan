import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const template = fileURLToPath(new URL('./sw.template.js', import.meta.url));
const CACHEABLE = /\.(html|css|js|json|webmanifest|svg|png|woff2)$/;
const INSTALL_ONLY = new Set(['icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']);
const GENERATED = new Set(['sw.js', 'src/version.js']);

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(path)));
    else out.push(relative(root, path).split(sep).join('/'));
  }
  return out;
}

async function build() {
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const files = (await listFiles(root)).filter((p) => !GENERATED.has(p) && CACHEABLE.test(p) && !INSTALL_ONLY.has(p)).sort();
  const hash = createHash('sha256').update(version);
  for (const p of files) hash.update(p).update(await readFile(join(root, p)));
  return { version, id: hash.digest('hex').slice(0, 12), files: [...files, 'src/version.js'].sort() };
}

export async function stampedVersionModule() {
  const { version, id } = await build();
  return `export const RELEASE = '${version}';\nexport const BUILD = '${id.slice(0, 7)}';\n`;
}

export async function stampedServiceWorker() {
  const source = await readFile(template, 'utf8');
  const { id, files } = await build();
  const shell = ['./', ...files].map((p) => `  '${p}',`).join('\n');
  return source
    .replace(/const VERSION = '[^']*';/, `const VERSION = 'sembilan-${id}';`)
    .replace(/const SHELL = \[[^\]]*\];/, `const SHELL = [\n${shell}\n];`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(join(root, 'src/version.js'), await stampedVersionModule());
  await writeFile(join(root, 'sw.js'), await stampedServiceWorker());
}
