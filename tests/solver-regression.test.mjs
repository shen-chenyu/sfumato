import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { construct, reconstruct } from '../public/construct-engine.mjs';

await test('cached harmonic stencils preserve the pre-optimization pixels and convergence', async () => {
  // Reference captured before caching the red/black free-cell stencil.
  // Covers sparse/dense constraints, natural image borders and early stopping.
  const reference = JSON.parse(
    await readFile(new URL('./solver-reference.json', import.meta.url), 'utf8'),
  );
  const pixels = Uint8ClampedArray.from({ length: 160 * 160 * 4 }, (_, i) =>
    i % 4 === 3
      ? 255
      : Math.hypot((Math.floor(i / 4) % 160) - 80, Math.floor(i / 640) - 80) <
          50
        ? 70
        : 240,
  );
  const model = construct(pixels);
  for (const { budget, iterations, sha256, stats } of reference) {
    const actual = reconstruct(model, { budget, iterations });
    assert.equal(
      createHash('sha256').update(actual.pixels).digest('hex'),
      sha256,
    );
    assert.deepEqual(actual.stats, stats);
  }
});
