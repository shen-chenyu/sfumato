import test from 'node:test';
import assert from 'node:assert/strict';
import { createPortrait, redraw, toSVG, describeMath, toMathCard, bezier } from '../packages/sfumato/dist/index.mjs';

function image(width, height, sample) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.set(sample(x, y), (y * width + x) * 4);
  }
  return { data, width, height };
}
const subject = () => image(91, 73, (x, y) =>
  Math.hypot(x - 46, y - 36) < 24 ? [60, 65, 70, 255] : [235, 235, 235, 255]);

await test('the public API handles rectangular pixels and replays a self-contained limited recipe', () => {
  const input = subject(), before = structuredClone(input);
  const result = createPortrait(input, { curves: 3, language: 'zh-CN' });
  assert.deepEqual(input, before);
  assert.ok(result.stats.curves > 0 && result.stats.curves <= 3);
  assert.equal(result.stats.curves, result.recipe.construction.curves.length);
  assert.match(result.explanation, /Bézier/);
  assert.equal(result.image.data.length, 160 * 160 * 4);
  const saved = JSON.stringify(result.recipe);
  assert.ok(!saved.includes('pixels') && !saved.includes('data:'));
  const again = redraw(JSON.parse(saved));
  assert.deepEqual(again.image, result.image);
  assert.equal(again.svg, result.svg);
  assert.deepEqual(again.math, result.math);
  assert.equal(again.card, result.card);
  assert.ok(!result.svg.includes('<image'));
});

await test('math counts and displayed example coefficients describe the actual recipe', () => {
  const recipe = createPortrait(image(160, 160, () => [128,128,128,255])).recipe;
  recipe.construction.curves = [{ id: 7, score: 1, sourceLength: 90, segments: [{
    controls: [[10,20], [20,30], [40,50], [80,60]],
    tones: [[.2,.3,.4],[.5,.6,.7]], maxError: 0, rmsError: 0, samples: 4,
  }] }];
  const math = describeMath(recipe);
  assert.equal(math.boundaryChains, 1);
  assert.equal(math.cubicSegments, 1);
  assert.equal(math.coordinatePolynomials, 2);
  assert.equal(math.geometryScalars, 8);
  assert.equal(math.curveToneSamples, 6);
  assert.equal(math.anchorScalars, 192);
  assert.equal(math.storedScalars, 206);
  assert.equal(math.recipeBytes, Buffer.byteLength(JSON.stringify(recipe), 'utf8'));
  const t = .37;
  const evaluate = (c) => c.reduce((sum, v, i) => sum + v * t**i, 0);
  const point = bezier(recipe.construction.curves[0].segments[0].controls, t);
  assert.ok(Math.abs(evaluate(math.example.x) - point[0]) < 1e-12);
  assert.ok(Math.abs(evaluate(math.example.y) - point[1]) < 1e-12);
  const card = toMathCard(recipe);
  assert.match(card, />206<\/text>/);
  assert.ok(!card.includes('<image') && !card.includes('<script'));
  recipe.construction.curves = [];
  const empty = describeMath(recipe);
  assert.equal(empty.example, null);
  assert.equal(empty.coordinatePolynomials, 0);
  assert.equal(empty.storedScalars, 192);
  assert.match(empty.summary, /No boundary curves/);
  assert.ok(!toMathCard(recipe).includes('x(t) ='));
});

await test('area resampling composites transparent RGB before averaging', () => {
  const transparent = image(320, 320, (x, y) => [x % 255, y % 255, 0, 0]);
  const opaque = image(320, 320, () => [255, 255, 255, 255]);
  const a = createPortrait(transparent), b = createPortrait(opaque);
  assert.deepEqual(a.image, b.image);
  assert.equal(a.stats.curves, 0);
  const checkerboard = image(320, 320, (x, y) => {
    const value = (x + y) % 2 ? 255 : 0;
    return [value, value, value, 255];
  });
  const reduced = createPortrait(checkerboard);
  assert.equal(reduced.stats.curves, 0);
  assert.ok(reduced.image.data[0] >= 126 && reduced.image.data[0] <= 129);
});

await test('edits alter the construction while preserving the previous result', () => {
  const original = createPortrait(subject());
  const edited = structuredClone(original.recipe);
  edited.construction.curves = [];
  const variation = redraw(edited);
  assert.ok(original.recipe.construction.curves.length > 0);
  assert.notDeepEqual(variation.image.data, original.image.data);
  assert.equal(variation.stats.curves, 0);
  assert.equal(toSVG(original.recipe, { size: 320 }).match(/width="320"/)?.[0], 'width="320"');
});

await test('invalid image formats, options and imported recipe numbers are rejected', () => {
  assert.throws(() => createPortrait({ data: new Float32Array(4), width: 1, height: 1 }));
  assert.throws(() => createPortrait({ data: new Uint8Array(3), width: 1, height: 1 }));
  assert.throws(() => createPortrait(subject(), { curves: -1 }));
  assert.throws(() => createPortrait(subject(), { language: 'unknown' }));
  const recipe = createPortrait(subject()).recipe;
  recipe.construction.curves[0].segments[0].controls[0][0] = NaN;
  assert.throws(() => redraw(recipe));
  assert.throws(() => toSVG(recipe));
});
