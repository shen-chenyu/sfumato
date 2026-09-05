import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialRound,
  revealReducer as step,
} from '../public/reveal-state.mjs';
import {
  construct,
  rankForReveal,
  reconstruct,
} from '../public/construct-engine.mjs';
const prepare = (n) => step(initialRound(), { type: 'prepared', total: n });
const frame = (s, count) =>
  step(s, { type: 'frame', epoch: s.epoch, frame: { count, pixels: [count] } });
test('stop records the displayed frame, never an unseen pending step', () => {
  let s = step(prepare(20), { type: 'start' });
  s = frame(s, 0);
  s = step(s, { type: 'advance' });
  s = frame(s, 1);
  s = step(s, { type: 'advance' });
  assert.equal(s.requested, 2);
  s = step(s, { type: 'stop' });
  assert.equal(s.stopAt, 1);
  const late = frame(s, 2);
  assert.equal(late, s);
  assert.deepEqual(late.frame.pixels, [1]);
});
test('a previous round cannot replace the current picture', () => {
  let s = step(prepare(3), { type: 'start' });
  const old = s.epoch;
  s = frame(s, 0);
  s = step(s, { type: 'stop' });
  s = step(s, { type: 'start' });
  assert.equal(step(s, { type: 'frame', epoch: old, frame: { count: 0 } }), s);
});
test('manual and automatic advance share a bounded progression', () => {
  let s = step(prepare(2), { type: 'start' });
  assert.equal(step(s, { type: 'advance' }), s);
  s = frame(s, 0);
  s = step(s, { type: 'advance' });
  assert.equal(step(s, { type: 'advance' }), s);
  s = frame(s, 1);
  s = step(s, { type: 'advance' });
  s = frame(s, 2);
  assert.equal(s.phase, 'result');
  assert.equal(s.finishReason, 'complete');
  assert.equal(s.stopAt, 2);
});
test('trimming preserves the original stopping point and can restore it', () => {
  let s = step(prepare(8), { type: 'start' });
  s = frame(s, 0);
  s = step(s, { type: 'advance' });
  s = frame(s, 1);
  s = step(s, { type: 'stop' });
  s = step(s, { type: 'trim', count: -10 });
  assert.equal(s.requested, 0);
  assert.equal(s.stopAt, 1);
  s = frame(s, 0);
  s = step(s, { type: 'return' });
  assert.equal(s.requested, 1);
  assert.equal(s.phase, 'result');
});
test('blank inputs cannot start a meaningless round', () => {
  const s = prepare(0);
  assert.equal(s.phase, 'empty');
  assert.equal(step(s, { type: 'start' }), s);
});
test('reveal ordering is deterministic and preserves the complete construction', () => {
  const pixels = Uint8ClampedArray.from({ length: 160 * 160 * 4 }, (_, i) =>
      i % 4 === 3
        ? 255
        : Math.hypot((Math.floor(i / 4) % 160) - 80, Math.floor(i / 640) - 80) <
            50
          ? 70
          : 240,
    ),
    m = construct(pixels),
    copy = structuredClone(m),
    r = rankForReveal(m);
  assert.deepEqual(m, copy);
  assert.deepEqual(r, rankForReveal(m));
  assert.deepEqual(
    new Set(r.curves.map((c) => c.id)),
    new Set(m.curves.map((c) => c.id)),
  );
  const a = reconstruct(m).pixels,
    b = reconstruct(r).pixels;
  assert.ok(a.every((v, i) => Math.abs(v - b[i]) <= 1));
});
