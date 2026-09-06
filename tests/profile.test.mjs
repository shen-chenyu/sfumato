import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPortrait,
  scorePortrait,
  redraw,
  describeMath,
} from '../packages/sfumato/dist/index.mjs';

function recipe() {
  return createPortrait({
    data: new Uint8Array([128, 128, 128, 255]),
    width: 1,
    height: 1,
  }).recipe;
}
function line(x, id = 1) {
  return {
    id,
    score: 1,
    sourceLength: 120,
    segments: [
      {
        controls: [
          [x, 20],
          [x, 60],
          [x, 100],
          [x, 140],
        ],
        tones: [
          [0.2, 0.2, 0.2],
          [0.8, 0.8, 0.8],
        ],
        maxError: 0,
        rmsError: 0,
        samples: 4,
      },
    ],
  };
}

await test('blank geometry has zero complexity and no invented symmetry score', () => {
  const r = recipe(),
    before = structuredClone(r);
  const scores = scorePortrait(r);
  assert.equal(scores.complexity.value, 0);
  assert.equal(scores.symmetry.value, null);
  assert.equal(scores.tone.value, 0);
  assert.deepEqual(r, before);
  assert.equal(scores.version, 'sfumato-profile-1');
});

await test('mirror scoring handles paired edges, the subpixel centre axis and asymmetric edits', () => {
  const r = recipe();
  r.construction.curves = [line(79.5)];
  assert.equal(scorePortrait(r).symmetry.value, 100);
  r.construction.curves = [line(30, 1), line(129, 2)];
  assert.equal(scorePortrait(r).symmetry.value, 100);
  r.construction.curves.pop();
  assert.equal(scorePortrait(r).symmetry.value, 0);
  const reflected = structuredClone(r);
  for (const s of reflected.construction.curves[0].segments)
    for (const p of s.controls) p[0] = 159 - p[0];
  assert.equal(
    scorePortrait(reflected).symmetry.value,
    scorePortrait(r).symmetry.value,
  );
  r.construction.curves = [line(-20)];
  assert.equal(scorePortrait(r).symmetry.value, null);
});

await test('tonal entropy has exact single-tone, two-tone and uniform-bin controls', () => {
  const r = recipe();
  r.construction.anchors.forEach((a, i) => {
    a.value = i % 2;
  });
  assert.equal(scorePortrait(r).tone.value, 25);
  r.construction.anchors.forEach((a, i) => {
    a.value = (i % 16) / 15;
  });
  const scores = scorePortrait(r);
  assert.equal(scores.tone.value, 100);
  assert.equal(scores.tone.entropyBits, 4);
  assert.deepEqual(scores.tone.histogram, Array.from({ length: 16 }, () => 4));
});

await test('complexity follows the published scale and scores survive JSON replay and language changes', () => {
  const r = recipe();
  r.construction.curves = [line(45)];
  const one = scorePortrait(r);
  assert.equal(
    one.complexity.value,
    Math.round((1000 * Math.log(2)) / Math.log(3001)) / 10,
  );
  r.construction.curves[0].segments = Array.from({ length: 3000 }, () =>
    structuredClone(r.construction.curves[0].segments[0]),
  );
  assert.equal(scorePortrait(r).complexity.value, 100);
  r.construction.curves[0].segments.length = 2;
  assert.ok(scorePortrait(r).complexity.value > one.complexity.value);
  const result = redraw(r);
  r.language = 'zh-CN';
  assert.deepEqual(describeMath(r).scores, result.math.scores);
  assert.deepEqual(
    redraw(JSON.parse(JSON.stringify(r))).math.scores,
    result.math.scores,
  );
  assert.match(result.card, /MATHEMATICAL PROFILE/);
  assert.match(result.explanation, /complexity/);
});
