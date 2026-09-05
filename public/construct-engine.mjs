/** Explicit image-boundary curves and harmonic tone reconstruction. No models. */
import { SIZE, blur } from './engine.mjs';
export const VERSION = 'sfumato-construction-1';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (a, b) => {
  const d = distance(a, b) || 1;
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
};
export function bezier(p, t) {
  const q = 1 - t;
  return [0, 1].map(
    (k) =>
      q * q * q * p[0][k] +
      3 * q * q * t * p[1][k] +
      3 * q * t * t * p[2][k] +
      t * t * t * p[3][k],
  );
}
export function polynomial(p) {
  return [0, 1].map((k) => [
    p[0][k],
    3 * (p[1][k] - p[0][k]),
    3 * (p[2][k] - 2 * p[1][k] + p[0][k]),
    p[3][k] - 3 * p[2][k] + 3 * p[1][k] - p[0][k],
  ]);
}
function sample(a, x, y, n = SIZE) {
  x = clamp(x, 0, n - 1.00001);
  y = clamp(y, 0, n - 1.00001);
  const i = Math.floor(x),
    j = Math.floor(y),
    u = x - i,
    v = y - j,
    k = j * n + i;
  return (
    (1 - v) * ((1 - u) * a[k] + u * a[k + 1]) +
    v * ((1 - u) * a[k + n] + u * a[k + n + 1])
  );
}
/** Adaptive least squares with endpoint tangents; measured error is at source parameters. */
export function fitCurve(points, tolerance = 0.8) {
  const result = [];
  function fit(a) {
    if (a.length < 2) return;
    const p0 = a[0],
      p3 = a.at(-1),
      chord = distance(p0, p3);
    if (chord < 1e-8 && a.length > 3) {
      const mid = Math.floor(a.length / 2);
      fit(a.slice(0, mid + 1));
      fit(a.slice(mid));
      return;
    }
    const t = [0];
    for (let i = 1; i < a.length; i++)
      t.push(t.at(-1) + distance(a[i - 1], a[i]));
    const length = t.at(-1) || 1;
    t.forEach((v, i) => (t[i] = v / length));
    const u = unit(p0, a[Math.min(3, a.length - 1)]),
      v = unit(a[Math.max(0, a.length - 4)], p3);
    let aa = 0,
      ab = 0,
      bb = 0,
      ar = 0,
      br = 0;
    for (let i = 0; i < a.length; i++) {
      const z = t[i],
        q = 1 - z,
        b0 = q ** 3,
        b1 = 3 * q * q * z,
        b2 = 3 * q * z * z,
        b3 = z ** 3;
      for (let k = 0; k < 2; k++) {
        const x = b1 * u[k],
          y = -b2 * v[k],
          r = a[i][k] - (b0 + b1) * p0[k] - (b2 + b3) * p3[k];
        aa += x * x;
        ab += x * y;
        bb += y * y;
        ar += x * r;
        br += y * r;
      }
    }
    const det = aa * bb - ab * ab;
    let alpha = det > 1e-10 ? (ar * bb - br * ab) / det : chord / 3,
      beta = det > 1e-10 ? (br * aa - ar * ab) / det : chord / 3;
    if (alpha < 0 || beta < 0 || alpha > length * 2 || beta > length * 2)
      alpha = beta = chord / 3;
    const controls = [
      p0,
      [p0[0] + alpha * u[0], p0[1] + alpha * u[1]],
      [p3[0] - beta * v[0], p3[1] - beta * v[1]],
      p3,
    ];
    let maxError = 0,
      split = 1,
      sum = 0;
    for (let i = 0; i < a.length; i++) {
      const e = distance(bezier(controls, t[i]), a[i]);
      sum += e * e;
      if (e > maxError) {
        maxError = e;
        split = i;
      }
    }
    if (maxError > tolerance && a.length > 2) {
      split = clamp(split, 1, a.length - 2);
      fit(a.slice(0, split + 1));
      fit(a.slice(split));
    } else
      result.push({
        controls: controls.map((p) => [...p]),
        maxError,
        rmsError: Math.sqrt(sum / a.length),
        samples: a.length,
      });
  }
  fit(points);
  return result;
}
function contours(gray) {
  const n = SIZE,
    m = n * n,
    gx = new Float64Array(m),
    gy = new Float64Array(m),
    mag = new Float64Array(m),
    thin = new Float64Array(m);
  for (let y = 1; y < n - 1; y++)
    for (let x = 1; x < n - 1; x++) {
      const k = y * n + x;
      gx[k] = (gray[k + 1] - gray[k - 1]) / 2;
      gy[k] = (gray[k + n] - gray[k - n]) / 2;
      mag[k] = Math.hypot(gx[k], gy[k]);
    }
  const peaks = [];
  for (let y = 2; y < n - 2; y++)
    for (let x = 2; x < n - 2; x++) {
      const k = y * n + x,
        v = mag[k];
      if (v < 0.003) continue;
      const dx = gx[k] / v,
        dy = gy[k] / v;
      if (
        v >= sample(mag, x + dx, y + dy) &&
        v >= sample(mag, x - dx, y - dy)
      ) {
        thin[k] = v;
        peaks.push(v);
      }
    }
  peaks.sort((a, b) => a - b);
  const high = Math.max(0.012, peaks[Math.floor(peaks.length * 0.67)] || 0),
    low = high * 0.35,
    edge = new Uint8Array(m),
    stack = [];
  for (let k = 0; k < m; k++)
    if (thin[k] >= high) {
      edge[k] = 1;
      stack.push(k);
    }
  while (stack.length) {
    const k = stack.pop();
    for (const d of [-n - 1, -n, -n + 1, -1, 1, n - 1, n, n + 1])
      if (!edge[k + d] && thin[k + d] >= low) {
        edge[k + d] = 1;
        stack.push(k + d);
      }
  }
  const adjacency = new Map();
  for (let k = 0; k < m; k++)
    if (edge[k]) {
      const neighbors = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = k + dy * n + dx;
          if (edge[j] && !(dx && dy && (edge[k + dx] || edge[k + dy * n])))
            neighbors.push(j);
        }
      adjacency.set(k, neighbors);
    }
  const visited = new Set(),
    chains = [],
    key = (a, b) => (a < b ? a * m + b : b * m + a);
  function walk(start, next) {
    const chain = [start];
    let prev = start,
      current = next;
    visited.add(key(start, next));
    while (true) {
      chain.push(current);
      const nb = adjacency.get(current);
      if (current === start || nb.length !== 2) break;
      const to = nb[0] === prev ? nb[1] : nb[0];
      if (visited.has(key(current, to))) break;
      visited.add(key(current, to));
      prev = current;
      current = to;
    }
    if (chain.length >= 8) chains.push(chain);
  }
  for (const [k, nb] of adjacency)
    if (nb.length !== 2)
      for (const j of nb) if (!visited.has(key(k, j))) walk(k, j);
  for (const [k, nb] of adjacency)
    for (const j of nb) if (!visited.has(key(k, j))) walk(k, j);
  return chains.map((chain) => ({
    points: chain.map((k) => [k % n, Math.floor(k / n)]),
    strength: chain.reduce((s, k) => s + mag[k], 0) / chain.length,
  }));
}
function sideTone(gray, controls) {
  const sides = [[], []];
  for (const t of [0, 0.5, 1]) {
    const p = bezier(controls, t),
      u = unit(
        bezier(controls, Math.max(0, t - 0.015)),
        bezier(controls, Math.min(1, t + 0.015)),
      );
    for (let side = 0; side < 2; side++) {
      const d = (side ? 1 : -1) * 1.65;
      sides[side].push(
        clamp(sample(gray, p[0] - u[1] * d, p[1] + u[0] * d), 0, 1),
      );
    }
  }
  return sides;
}
export function construct(rgba, { tolerance = 0.8 } = {}) {
  if (rgba.length !== SIZE * SIZE * 4)
    throw Error('Expected 160 × 160 RGBA pixels.');
  if (!Number.isFinite(tolerance) || tolerance < 0.15 || tolerance > 4)
    throw Error('Invalid fitting tolerance.');
  const raw = new Float64Array(SIZE * SIZE);
  for (let i = 0; i < raw.length; i++) {
    const alpha = rgba[4 * i + 3] / 255;
    raw[i] =
      1 -
      alpha +
      (alpha *
        (0.2126 * rgba[4 * i] +
          0.7152 * rgba[4 * i + 1] +
          0.0722 * rgba[4 * i + 2])) /
        255;
  }
  const gray = blur(raw, 1),
    chains = contours(gray),
    curves = chains
      .map((c, id) => {
        const center = c.points.reduce(
          (a, p) => [
            a[0] + p[0] / c.points.length,
            a[1] + p[1] / c.points.length,
          ],
          [0, 0],
        );
        const attention =
          1 +
          0.8 *
            Math.exp(
              -(
                (center[0] / SIZE - 0.5) ** 2 +
                (center[1] / SIZE - 0.45) ** 2
              ) / 0.13,
            );
        return {
          id,
          score: c.points.length * c.strength * attention,
          segments: fitCurve(c.points, tolerance).map((s) => ({
            ...s,
            tones: sideTone(gray, s.controls),
          })),
          sourceLength: c.points.length,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 180);
  const anchors = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const px = (x * (SIZE - 1)) / 7,
        py = (y * (SIZE - 1)) / 7;
      anchors.push({ x: px, y: py, value: clamp(sample(gray, px, py), 0, 1) });
    }
  return {
    version: VERSION,
    size: SIZE,
    tolerance,
    curves,
    anchors,
    description:
      'Image brightness boundaries fitted with cubic Bézier curves. These are not identified anatomical features. Tone comes from two-sided curve samples and 64 coarse anchors; the source photograph is not needed for reconstruction.',
  };
}
export function validateConstruction(model) {
  const finite = (v, a, b) =>
    typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;
  if (
    !model ||
    model.version !== VERSION ||
    model.size !== SIZE ||
    !Array.isArray(model.curves) ||
    model.curves.length > 180 ||
    !Array.isArray(model.anchors) ||
    model.anchors.length !== 64
  )
    throw Error('This is not a supported Sfumato construction.');
  const ids = new Set();
  let segments = 0;
  for (const c of model.curves) {
    if (
      !Number.isInteger(c.id) ||
      ids.has(c.id) ||
      !Array.isArray(c.segments) ||
      !c.segments.length
    )
      throw Error('Invalid curve.');
    ids.add(c.id);
    segments += c.segments.length;
    for (const s of c.segments) {
      if (
        !Array.isArray(s.controls) ||
        s.controls.length !== 4 ||
        s.controls.some(
          (p) =>
            !Array.isArray(p) ||
            p.length !== 2 ||
            p.some((v) => !finite(v, -SIZE * 2, SIZE * 3)),
        ) ||
        !Array.isArray(s.tones) ||
        s.tones.length !== 2 ||
        s.tones.some(
          (a) =>
            !Array.isArray(a) ||
            a.length !== 3 ||
            a.some((v) => !finite(v, 0, 1)),
        )
      )
        throw Error('Invalid curve parameters.');
    }
  }
  if (segments > 3000) throw Error('Too many curve segments.');
  for (const a of model.anchors)
    if (
      !finite(a.x, 0, SIZE - 1) ||
      !finite(a.y, 0, SIZE - 1) ||
      !finite(a.value, 0, 1)
    )
      throw Error('Invalid tone anchor.');
  return model;
}
export function reconstruct(
  model,
  {
    budget = model.curves.length,
    excluded = [],
    iterations = 500,
    tolerance = 1e-5,
  } = {},
) {
  validateConstruction(model);
  if (
    !Number.isInteger(budget) ||
    budget < 0 ||
    budget > 180 ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 3000 ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0
  )
    throw Error('Invalid reconstruction settings.');
  const n = SIZE,
    m = n * n,
    values = new Float64Array(m),
    weight = new Float64Array(m),
    skip = new Set(excluded),
    curves = model.curves.slice(0, budget).filter((c) => !skip.has(c.id));
  const splat = (x, y, value, w = 1) => {
    if (x < 0 || y < 0 || x > n - 1 || y > n - 1) return;
    const k = Math.round(y) * n + Math.round(x);
    values[k] += w * value;
    weight[k] += w;
  };
  for (const a of model.anchors) splat(a.x, a.y, a.value, 0.7);
  for (const c of curves)
    for (const s of c.segments) {
      const p = s.controls,
        len =
          distance(p[0], p[1]) + distance(p[1], p[2]) + distance(p[2], p[3]),
        steps = Math.max(4, Math.ceil(len * 1.5));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps,
          point = bezier(p, t),
          u = unit(
            bezier(p, Math.max(0, t - 0.01)),
            bezier(p, Math.min(1, t + 0.01)),
          ),
          half = t < 0.5 ? 0 : 1,
          f = t < 0.5 ? t * 2 : t * 2 - 1;
        for (let side = 0; side < 2; side++) {
          const d = (side ? 1 : -1) * 1.65,
            value = s.tones[side][half] * (1 - f) + s.tones[side][half + 1] * f;
          splat(point[0] - u[1] * d, point[1] + u[0] * d, value);
        }
      }
    }
  const field = new Float64Array(m).fill(
    model.anchors.reduce((a, p) => a + p.value, 0) / model.anchors.length,
  );
  let constraints = 0;
  for (let k = 0; k < m; k++)
    if (weight[k]) {
      field[k] = values[k] / weight[k];
      constraints++;
    }
  let completed = 0,
    maxChange = Infinity;
  for (let it = 0; it < iterations; it++) {
    maxChange = 0;
    for (let parity = 0; parity < 2; parity++)
      for (let y = 0; y < n; y++)
        for (let x = (y + parity) % 2; x < n; x += 2) {
          const k = y * n + x;
          if (weight[k]) continue;
          let sum = 0,
            degree = 0;
          if (x) {
            sum += field[k - 1];
            degree++;
          }
          if (x < n - 1) {
            sum += field[k + 1];
            degree++;
          }
          if (y) {
            sum += field[k - n];
            degree++;
          }
          if (y < n - 1) {
            sum += field[k + n];
            degree++;
          }
          const delta = 1.75 * (sum / degree - field[k]);
          field[k] += delta;
          maxChange = Math.max(maxChange, Math.abs(delta));
        }
    completed = it + 1;
    if (maxChange < tolerance) break;
  }
  let residual = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const k = y * n + x;
      if (weight[k]) continue;
      let sum = 0,
        degree = 0;
      for (const [j, ok] of [
        [k - 1, x > 0],
        [k + 1, x < n - 1],
        [k - n, y > 0],
        [k + n, y < n - 1],
      ])
        if (ok) {
          sum += field[j];
          degree++;
        }
      residual = Math.max(residual, Math.abs(field[k] - sum / degree));
    }
  const pixels = new Uint8ClampedArray(m * 4);
  for (let i = 0; i < m; i++) {
    const v = clamp(field[i], 0, 1);
    pixels[i * 4] = Math.round(v * 255);
    pixels[i * 4 + 1] = Math.round(v * 254);
    pixels[i * 4 + 2] = Math.round(v * 250);
    pixels[i * 4 + 3] = 255;
  }
  return {
    pixels,
    stats: {
      curves: curves.length,
      segments: curves.reduce((a, c) => a + c.segments.length, 0),
      scalarParameters:
        curves.reduce((a, c) => a + 14 * c.segments.length, 0) +
        model.anchors.length * 3,
      constraints,
      iterations: completed,
      maxChange,
      residual,
      converged: maxChange < tolerance,
    },
  };
}

/** Move one handle; endpoint edits preserve existing C0 connections within a chain. */
export function moveControlPoint(model, id, index, handle, x, y) {
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(handle) ||
    handle < 0 ||
    handle > 3 ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  )
    throw Error('Invalid control-point edit.');
  const curve = model.curves.find((c) => c.id === id);
  if (!curve?.segments[index]) throw Error('Curve segment not found.');
  const updated = structuredClone(model),
    c = updated.curves.find((c) => c.id === id),
    s = c.segments[index],
    old = [...s.controls[handle]],
    next = [clamp(x, 0, SIZE - 1), clamp(y, 0, SIZE - 1)],
    delta = [next[0] - old[0], next[1] - old[1]];
  s.controls[handle] = next;
  s.edited = true;
  if (handle === 0 || handle === 3) {
    const h = handle === 0 ? 1 : 2;
    s.controls[h] = s.controls[h].map((v, k) => v + delta[k]);
    const neighbor =
        (index + (handle === 0 ? -1 : 1) + c.segments.length) %
        c.segments.length,
      end = handle === 0 ? 3 : 0,
      adj = c.segments[neighbor];
    if (neighbor !== index && distance(adj.controls[end], old) < 1e-8) {
      adj.controls[end] = [...next];
      adj.controls[end === 0 ? 1 : 2] = adj.controls[end === 0 ? 1 : 2].map(
        (v, k) => v + delta[k],
      );
      adj.edited = true;
    }
  }
  return updated;
}

/** Reveal ordering favors compact central detail over very long boundary chains.
 * It is an image-space heuristic, not anatomical detection or optimal selection.
 */
export function rankForReveal(model) {
  const curves = model.curves
    .map((c) => {
      const points = c.segments.flatMap((s) => [s.controls[0], s.controls[3]]),
        x = points.reduce((a, p) => a + p[0] / SIZE, 0) / points.length,
        y = points.reduce((a, p) => a + p[1] / SIZE, 0) / points.length;
      const focus =
          1 + 4 * Math.exp(-((x - 0.5) ** 2 + (y - 0.48) ** 2) / 0.065),
        length = Math.max(1, c.sourceLength ?? points.length);
      return {
        ...c,
        revealPriority:
          (((c.score ?? 1) / Math.sqrt(length)) * focus) /
          (1 + 0.1 * c.segments.length),
      };
    })
    .sort((a, b) => b.revealPriority - a.revealPriority || a.id - b.id);
  return { ...model, curves, ordering: 'compact-center-v1' };
}
