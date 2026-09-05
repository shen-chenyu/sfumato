import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.BASE_PATH || '';
if (
  base &&
  (!/^(\/[A-Za-z0-9_.-]+)+$/.test(base) ||
    base.split('/').some((p) => p === '.' || p === '..'))
)
  throw Error(
    'BASE_PATH must be a safe absolute subdirectory without a trailing slash.',
  );
const root = resolve('dist/client');
// Vinext emits assetPrefix into both URLs and disk paths. A subdirectory host
// supplies the URL prefix itself, so static assets must live at the output root.
if (base)
  await cp(resolve(root, '.' + base, '_next'), resolve(root, '_next'), {
    recursive: true,
  });
// Export non-root routes without redirecting the prerender request, then
// provide directory indexes for simple static hosts.
await mkdir(resolve(root, 'strokes'), { recursive: true });
await cp(resolve(root, 'strokes.html'), resolve(root, 'strokes/index.html'));
const html = await readFile(resolve(root, 'index.html'), 'utf8');
for (const match of html.matchAll(
  /(?:src|href)="(\/[^"]+\.(?:js|css|png|svg))"/g,
)) {
  const url = match[1];
  if (base && !url.startsWith(base + '/'))
    throw Error(`Asset lost its host prefix: ${url}`);
  await stat(resolve(root, '.' + url.slice(base.length)));
}
for (const file of [
  'engine.worker.mjs',
  'engine.mjs',
  'portrait.png',
  'construct.worker.mjs',
  'construct-engine.mjs',
  'strokes/index.html',
])
  await stat(resolve(root, file));
await writeFile(resolve(root, '.nojekyll'), '');
console.log(`Static export verified${base ? ` for ${base}` : ''}.`);
