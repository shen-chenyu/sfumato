import { cp, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const target = new URL('packages/sfumato/dist/', root);
await mkdir(target, { recursive: true });
for (const [source, name] of [
  ['public/construct-engine.mjs', 'construct-engine.mjs'],
  ['public/engine.mjs', 'engine.mjs'],
  ['public/portrait.mjs', 'index.mjs'],
  ['public/portrait.d.mts', 'index.d.ts'],
])
  await cp(new URL(source, root), new URL(name, target));
await cp(new URL('LICENSE', root), new URL('packages/sfumato/LICENSE', root));
console.log(
  'Built the standalone package from the same engine used by the demo.',
);
