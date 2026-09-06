import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze,
  blur,
  generate,
  select,
  evaluate,
  svg,
  SIZE,
} from '../public/engine.mjs';
const pixels = (fn) =>
  Uint8ClampedArray.from({ length: SIZE * SIZE * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : fn(Math.floor(i / 4) % SIZE, Math.floor(i / 4 / SIZE)),
  );
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
await test('constant images remain constant after smoothing', () => {
  for (const v of [0, 0.17, 1])
    for (const x of blur(new Float64Array(49).fill(v), 2, 7)) near(x, v);
});
await test('empty paper chooses no decorative marks', () => {
  const r = generate(pixels(() => 255));
  assert.equal(r.strokes.length, 0);
  assert.equal(r.initialLoss, 0);
  assert.equal(r.finalLoss, 0);
});
await test('bad inputs and settings fail explicitly', () => {
  assert.throws(() => analyze([]));
  assert.throws(() =>
    generate(
      pixels(() => 100),
      { focus: [-1, 0.5] },
    ),
  );
  assert.throws(() =>
    generate(
      pixels(() => 100),
      { budget: Infinity },
    ),
  );
  assert.throws(() =>
    generate(
      pixels(() => 100),
      { style: 'magic' },
    ),
  );
});
await test('lazy search matches exhaustive greedy search and independently replayed error', () => {
  const weights = Float64Array.from([1, 2, 3, 1]);
  const target = Float64Array.from([0.7, 0.5, 0.4, 0.9]);
  const pool = [
    [1, 0.3, 0, 0],
    [0.4, 0.8, 0.2, 0],
    [0, 0.3, 0.8, 0.1],
    [0, 0, 0.2, 1],
    [0.3, 0, 0, 0.4],
  ].map((values, id) => ({
    ids: [0, 1, 2, 3],
    values,
    norm: values.reduce((a, v, i) => a + v * v * weights[i], 0),
    cost: 0.01,
    points: [0, 0, 1, 1],
    width: 1,
    id,
  }));
  const result = select({ target, weights }, pool, { budget: 5 });
  const remaining = new Set(pool.map((_, i) => i)),
    residual = Float64Array.from(target);
  for (const s of result.strokes) {
    const candidates = [...remaining]
      .map((id) => ({ id, ...evaluate(pool[id], residual, weights) }))
      .sort((a, b) => b.gain - a.gain);
    assert.equal(s.id, candidates[0].id);
    remaining.delete(s.id);
    pool[s.id].values.forEach((v, i) => (residual[i] -= s.alpha * v));
    near(
      s.lossAfter,
      residual.reduce((a, v, i) => a + weights[i] * v * v, 0),
    );
    assert.ok(s.lossAfter < s.lossBefore);
  }
  near(
    result.finalLoss,
    residual.reduce((a, v, i) => a + weights[i] * v * v, 0),
  );
});
await test('a drawing is deterministic, finite and replayable in every hand', () => {
  const input = pixels((x, y) =>
    Math.hypot(x - 78, y - 70) < 37 ? 60 + Math.round(x / 2) : 250,
  );
  for (const style of ['pencil', 'etch', 'wash']) {
    const a = generate(input, { style, budget: 30 }),
      b = generate(input, { style, budget: 30 });
    assert.deepEqual(a, b);
    assert.equal(a.strokes.length, 30);
    assert.equal(new Set(a.strokes.map((s) => s.id)).size, 30);
    for (const s of a.strokes) {
      assert.ok(s.gain > 0);
      assert.ok(s.lossAfter < s.lossBefore);
      assert.ok(s.points.every(Number.isFinite));
    }
    const output = svg(a, 12);
    assert.equal((output.match(/<path /g) || []).length, 12);
    assert.ok(!/NaN|Infinity/.test(output));
    assert.ok(!output.includes('<image'));
  }
});
await test('random order is seeded and still only accepts useful strokes', () => {
  const input = pixels((x, y) =>
    x > 30 && y > 30 && x < 120 && y < 120 ? 120 : 255,
  );
  const settings = { strategy: 'random', budget: 20, seed: 6 };
  const a = generate(input, settings);
  assert.deepEqual(a, generate(input, settings));
  assert.notDeepEqual(
    a.strokes,
    generate(input, { ...settings, seed: 7 }).strokes,
  );
  assert.ok(a.strokes.every((s) => s.gain > 0));
});
