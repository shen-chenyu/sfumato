import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bezier,
  polynomial,
  fitCurve,
  construct,
  reconstruct,
  validateConstruction,
} from '../public/construct-engine.mjs';
const pixels = (fn) =>
  Uint8ClampedArray.from({ length: 160 * 160 * 4 }, (_, i) =>
    i % 4 === 3 ? 255 : fn(Math.floor(i / 4) % 160, Math.floor(i / 640)),
  );
const subject = () =>
  pixels((x, y) =>
    Math.hypot((x - 80) / 0.8, y - 75) < 43 ? 70 + Math.round(x * 0.5) : 230,
  );
test('cubic coefficients reproduce the curve including endpoints', () => {
  const p = [
      [2, 3],
      [7, 19],
      [24, -3],
      [31, 12],
    ],
    coeff = polynomial(p);
  for (const t of [0, 0.1, 0.34, 0.7, 1])
    for (let k = 0; k < 2; k++)
      assert.ok(
        Math.abs(
          bezier(p, t)[k] - coeff[k].reduce((sum, a, i) => sum + a * t ** i, 0),
        ) < 1e-10,
      );
});
test('adaptive fitting preserves endpoints and the measured tolerance on a difficult curve', () => {
  const points = Array.from({ length: 120 }, (_, i) => [
      i,
      30 * Math.sin(i * 0.11),
    ]),
    pieces = fitCurve(points, 0.7);
  assert.ok(pieces.length > 1);
  assert.deepEqual(pieces[0].controls[0], points[0]);
  assert.deepEqual(pieces.at(-1).controls[3], points.at(-1));
  assert.ok(pieces.every((p) => p.maxError <= 0.70000001));
  for (let i = 1; i < pieces.length; i++)
    assert.deepEqual(pieces[i - 1].controls[3], pieces[i].controls[0]);
  const cusp = fitCurve(
    [
      [0, 0],
      [3, 9],
      [6, 0],
    ],
    0.1,
  );
  assert.ok(cusp.every((p) => p.maxError <= 0.10000001));
});
test('uniform input produces no invented curves and harmonic reconstruction stays constant', () => {
  const m = construct(pixels(() => 153));
  assert.equal(m.curves.length, 0);
  const r = reconstruct(m);
  assert.ok(r.stats.converged);
  for (let i = 0; i < r.pixels.length; i += 4) assert.equal(r.pixels[i], 153);
});
test('the serialized construction redraws without a photograph', () => {
  const m = construct(subject()),
    a = reconstruct(m),
    b = reconstruct(JSON.parse(JSON.stringify(m)));
  assert.ok(m.curves.length > 0);
  assert.deepEqual(a.pixels, b.pixels);
  assert.ok(a.stats.residual < 1e-5);
  assert.ok(!('pixels' in m));
  assert.ok(!('gray' in m));
});
test('removing and editing a curve alter the solve without resampling the input', () => {
  const m = construct(subject()),
    a = reconstruct(m),
    deleted = reconstruct(m, { excluded: [m.curves[0].id] }),
    edited = structuredClone(m);
  edited.curves[0].segments[0].controls[1][0] += 12;
  assert.notDeepEqual(a.pixels, deleted.pixels);
  assert.notDeepEqual(a.pixels, reconstruct(edited).pixels);
  assert.deepEqual(a.pixels, reconstruct(m).pixels);
});
test('untrusted recipes reject invalid geometry, tone, duplicate IDs and excessive work', () => {
  const m = construct(subject());
  for (const edit of [
    (x) => (x.curves[0].segments[0].controls[0][0] = Infinity),
    (x) => (x.curves[0].segments[0].tones[0][0] = -1),
    (x) => x.curves.push(x.curves[0]),
    (x) => (x.anchors = []),
  ]) {
    const bad = structuredClone(m);
    edit(bad);
    assert.throws(() => validateConstruction(bad));
  }
  assert.throws(() => reconstruct(m, { budget: -1 }));
  assert.throws(() => reconstruct(m, { iterations: 1e9 }));
});

test('moving a shared endpoint preserves curve-chain connections without mutating the original', async () => {
  const { moveControlPoint } = await import('../public/construct-engine.mjs');
  const tone = [
      [0.2, 0.3, 0.4],
      [0.6, 0.7, 0.8],
    ],
    m = {
      curves: [
        {
          id: 7,
          segments: [
            {
              controls: [
                [0, 0],
                [2, 2],
                [5, 8],
                [8, 8],
              ],
              tones: tone,
            },
            {
              controls: [
                [8, 8],
                [12, 8],
                [15, 4],
                [20, 4],
              ],
              tones: tone,
            },
          ],
        },
      ],
    };
  const moved = moveControlPoint(m, 7, 0, 3, 10, 12);
  assert.deepEqual(moved.curves[0].segments[0].controls[3], [10, 12]);
  assert.deepEqual(moved.curves[0].segments[1].controls[0], [10, 12]);
  assert.deepEqual(moved.curves[0].segments[1].controls[1], [14, 12]);
  assert.deepEqual(m.curves[0].segments[0].controls[3], [8, 8]);
  assert.throws(() => moveControlPoint(m, 7, 0, 8, 0, 0));
});

test('white, black and transparent sources keep valid normalized constraints', () => {
  for (const input of [
    pixels(() => 255),
    pixels(() => 0),
    new Uint8ClampedArray(160 * 160 * 4),
    pixels((x, y) => (x > 80 && y > 40 ? 255 : 0)),
  ]) {
    const m = construct(input);
    assert.doesNotThrow(() => validateConstruction(m));
    assert.doesNotThrow(() => reconstruct(m));
  }
});
