/** Browser-only computational drawing. No models, DOM, network or dependencies. */
export const SIZE = 160,
  ENGINE_VERSION = '0.1.0';
const C = 40,
  clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export function random(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function blur(input, r, n = SIZE) {
  let data = Float64Array.from(input);
  for (let pass = 0; pass < 2; pass++)
    for (let axis = 0; axis < 2; axis++) {
      const out = new Float64Array(n * n);
      for (let a = 0; a < n; a++) {
        const at = (b) => (axis ? b * n + a : a * n + b);
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += data[at(clamp(k, 0, n - 1))];
        for (let b = 0; b < n; b++) {
          out[at(b)] = sum / (2 * r + 1);
          sum +=
            data[at(clamp(b + r + 1, 0, n - 1))] -
            data[at(clamp(b - r, 0, n - 1))];
        }
      }
      data = out;
    }
  return data;
}
function sample(a, x, y) {
  x = clamp(x, 0, SIZE - 1.001);
  y = clamp(y, 0, SIZE - 1.001);
  const i = Math.floor(x),
    j = Math.floor(y),
    u = x - i,
    v = y - j,
    k = j * SIZE + i;
  return (
    (1 - v) * ((1 - u) * a[k] + u * a[k + 1]) +
    v * ((1 - u) * a[k + SIZE] + u * a[k + SIZE + 1])
  );
}
export function analyze(rgba, focus = [0.5, 0.4]) {
  if (rgba.length !== SIZE * SIZE * 4)
    throw Error('Expected 160 × 160 RGBA pixels.');
  if (
    !Array.isArray(focus) ||
    focus.length !== 2 ||
    focus.some((v) => !Number.isFinite(v) || v < 0 || v > 1)
  )
    throw Error('Focus must be inside the image.');
  const n = SIZE * SIZE,
    gray = new Float64Array(n);
  for (let i = 0; i < n; i++)
    gray[i] =
      (0.2126 * rgba[i * 4] +
        0.7152 * rgba[i * 4 + 1] +
        0.0722 * rgba[i * 4 + 2]) /
      255;
  const smooth = blur(gray, 1),
    broad = blur(gray, 3),
    edge = new Float64Array(n);
  let a = new Float64Array(n),
    b = new Float64Array(n),
    c = new Float64Array(n);
  for (let y = 1; y < SIZE - 1; y++)
    for (let x = 1; x < SIZE - 1; x++) {
      const k = y * SIZE + x,
        gx = (smooth[k + 1] - smooth[k - 1]) / 2,
        gy = (smooth[k + SIZE] - smooth[k - SIZE]) / 2;
      a[k] = gx * gx;
      b[k] = gx * gy;
      c[k] = gy * gy;
      edge[k] = Math.hypot(gx, gy);
    }
  a = blur(a, 2);
  b = blur(b, 2);
  c = blur(c, 2);
  let qx = new Float64Array(n),
    qy = new Float64Array(n);
  const density = new Float64Array(n),
    target = new Float64Array(n + C * C),
    weights = new Float64Array(n + C * C);
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const k = y * SIZE + x,
        length = Math.hypot(a[k] - c[k], 2 * b[k]),
        reliability =
          ((0.6 * length) / (a[k] + c[k] + 1e-9)) *
          Math.min(1, Math.sqrt(a[k] + c[k]) * 20),
        prior = -0.78 + 0.15 * Math.sin(x / 43);
      qx[k] =
        (reliability * (c[k] - a[k])) / (length + 1e-9) +
        (1 - reliability) * Math.cos(2 * prior);
      qy[k] =
        (-reliability * 2 * b[k]) / (length + 1e-9) +
        (1 - reliability) * Math.sin(2 * prior);
      weights[k] =
        0.6 +
        5 *
          Math.exp(
            -((x / SIZE - focus[0]) ** 2 + (y / SIZE - focus[1]) ** 2) / 0.045,
          );
      const tone = clamp((0.96 - smooth[k]) / 0.86, 0, 1) ** 1.35,
        detail = Math.max(0, broad[k] - smooth[k]);
      density[k] = 0.62 * tone;
      target[k] = clamp(0.58 * tone + 1.4 * detail + 0.25 * edge[k], 0, 1);
      const ck = n + Math.floor(y / 4) * C + Math.floor(x / 4);
      target[ck] += density[k] / 16;
      weights[ck] += weights[k] * 2;
    }
  qx = blur(qx, 1);
  qy = blur(qy, 1);
  return { gray, qx, qy, density, target, weights };
}
function mask(points, width, soft) {
  const radius = Math.ceil(width * (soft ? 1.8 : 0.6) + 1);
  let x0 = SIZE,
    y0 = SIZE,
    x1 = 0,
    y1 = 0;
  for (let i = 0; i < points.length; i += 2) {
    x0 = Math.min(x0, points[i]);
    x1 = Math.max(x1, points[i]);
    y0 = Math.min(y0, points[i + 1]);
    y1 = Math.max(y1, points[i + 1]);
  }
  x0 = Math.max(0, Math.floor(x0 - radius));
  y0 = Math.max(0, Math.floor(y0 - radius));
  x1 = Math.min(SIZE - 1, Math.ceil(x1 + radius));
  y1 = Math.min(SIZE - 1, Math.ceil(y1 + radius));
  const w = x1 - x0 + 1,
    patch = new Float64Array(w * (y1 - y0 + 1));
  for (let p = 0; p < points.length; p += 2) {
    const x = points[p],
      y = points[p + 1],
      pressure =
        0.3 +
        0.7 * Math.sin((Math.PI * p) / Math.max(2, points.length - 2)) ** 0.35,
      r = (width * pressure) / 2;
    for (
      let yy = Math.max(y0, Math.floor(y - radius));
      yy <= Math.min(y1, Math.ceil(y + radius));
      yy++
    )
      for (
        let xx = Math.max(x0, Math.floor(x - radius));
        xx <= Math.min(x1, Math.ceil(x + radius));
        xx++
      ) {
        const d = Math.hypot(xx - x, yy - y),
          v = soft
            ? Math.exp(-0.5 * (d / Math.max(0.4, r)) ** 2)
            : clamp(r + 0.65 - d, 0, 1),
          k = (yy - y0) * w + xx - x0;
        if (v > patch[k]) patch[k] = v;
      }
  }
  const ids = [],
    values = [],
    coarse = new Map();
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const v = patch[(y - y0) * w + x - x0];
      if (v < 0.008) continue;
      ids.push(y * SIZE + x);
      values.push(v);
      const c = SIZE * SIZE + Math.floor(y / 4) * C + Math.floor(x / 4);
      coarse.set(c, (coarse.get(c) || 0) + v / 16);
    }
  for (const [k, v] of coarse) {
    ids.push(k);
    values.push(v);
  }
  return { ids: Uint32Array.from(ids), values: Float64Array.from(values) };
}
export function buildCandidates(f, style = 'pencil', seed = 42) {
  const rng = random(seed),
    pool = [];
  for (let y = 3; y < SIZE - 3; y += 2)
    for (let x = 3; x < SIZE - 3; x += 2) {
      const sx = x + rng() * 1.6 - 0.8,
        sy = y + rng() * 1.6 - 0.8;
      if (sample(f.density, sx, sy) < 0.01) continue;
      for (const family of [0, 1, 2]) {
        const steps = [3, 5, 9][family],
          soft = style === 'wash' && family > 0,
          width = soft
            ? [0, 2.2, 4.4][family]
            : style === 'etch'
              ? [0.5, 0.7, 0.95][family]
              : [0.55, 0.85, 1.3][family],
          halves = [];
        for (const sign of [-1, 1]) {
          let px = sx,
            py = sy,
            angle =
              0.5 * Math.atan2(sample(f.qy, px, py), sample(f.qx, px, py)),
            dx = Math.cos(angle) * sign,
            dy = Math.sin(angle) * sign;
          const half = [];
          for (let step = 0; step < steps; step++) {
            if (
              px < 2 ||
              py < 2 ||
              px > SIZE - 3 ||
              py > SIZE - 3 ||
              sample(f.density, px, py) < 0.005
            )
              break;
            half.push([px, py]);
            angle =
              0.5 * Math.atan2(sample(f.qy, px, py), sample(f.qx, px, py));
            let ux = Math.cos(angle),
              uy = Math.sin(angle);
            if (ux * dx + uy * dy < 0) {
              ux = -ux;
              uy = -uy;
            }
            dx = 0.65 * dx + 0.35 * ux;
            dy = 0.65 * dy + 0.35 * uy;
            const n = Math.hypot(dx, dy);
            dx /= n;
            dy /= n;
            px += dx * 0.8;
            py += dy * 0.8;
          }
          halves.push(half);
        }
        const pairs = halves[0].reverse().concat(halves[1].slice(1));
        if (pairs.length < 4) continue;
        const points = pairs.flat().map((v) => Math.round(v * 1000) / 1000),
          atom = mask(points, width, soft);
        let norm = 0;
        for (let j = 0; j < atom.ids.length; j++)
          norm += f.weights[atom.ids[j]] * atom.values[j] ** 2;
        pool.push({
          points,
          width,
          soft,
          ...atom,
          norm,
          cost: 0.004 * (1 + pairs.length / 30),
          x: sx / SIZE,
          y: sy / SIZE,
        });
      }
    }
  return pool;
}
export class MaxHeap {
  items = [];
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].gain >= item.gain) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items,
      top = a[0],
      last = a.pop();
    if (a.length) {
      let i = 0;
      while (2 * i + 1 < a.length) {
        let c = 2 * i + 1;
        if (c + 1 < a.length && a[c + 1].gain > a[c].gain) c++;
        if (a[c].gain <= last.gain) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return top;
  }
  get size() {
    return this.items.length;
  }
  get best() {
    return this.items[0]?.gain ?? -Infinity;
  }
}
export function evaluate(c, residual, weights) {
  let dot = 0;
  for (let j = 0; j < c.ids.length; j++)
    dot += weights[c.ids[j]] * c.values[j] * residual[c.ids[j]];
  const alpha = clamp(dot / Math.max(c.norm, 1e-12), 0, 0.95),
    reduction = 2 * alpha * dot - alpha * alpha * c.norm;
  return { gain: reduction - c.cost, alpha, reduction };
}
export function select(
  f,
  pool,
  { budget = 1200, strategy = 'smart', seed = 42, progress = () => {} } = {},
) {
  const residual = Float64Array.from(f.target),
    heap = new MaxHeap(),
    strokes = [];
  let loss = 0;
  for (let i = 0; i < residual.length; i++)
    loss += f.weights[i] * residual[i] ** 2;
  const initialLoss = loss,
    rng = random(seed),
    order = Array.from({ length: pool.length }, (_, i) => i);
  if (strategy === 'random')
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  else
    for (let i = 0; i < pool.length; i++)
      heap.push({ id: i, ...evaluate(pool[i], residual, f.weights) });
  let cursor = 0;
  while (
    strokes.length < budget &&
    (strategy === 'random' ? cursor < order.length : heap.size)
  ) {
    let id, score;
    if (strategy === 'random') {
      id = order[cursor++];
      score = evaluate(pool[id], residual, f.weights);
    } else {
      id = heap.pop().id;
      score = evaluate(pool[id], residual, f.weights);
      if (score.gain < heap.best - 1e-9) {
        heap.push({ id, ...score });
        continue;
      }
    }
    if (score.gain <= 0) {
      if (strategy === 'smart') break;
      else continue;
    }
    const c = pool[id],
      before = loss;
    for (let j = 0; j < c.ids.length; j++)
      residual[c.ids[j]] -= score.alpha * c.values[j];
    loss -= score.reduction;
    strokes.push({
      id,
      points: c.points,
      width: c.width,
      soft: c.soft,
      alpha: score.alpha,
      gain: score.gain,
      reduction: score.reduction,
      lossBefore: before,
      lossAfter: loss,
      x: c.x,
      y: c.y,
    });
    if (strokes.length % 40 === 0) progress(strokes.length, budget);
  }
  return {
    strokes,
    initialLoss,
    finalLoss: loss,
    candidateCount: pool.length,
    version: ENGINE_VERSION,
  };
}
export function generate(rgba, settings = {}, progress = () => {}) {
  const {
    style = 'pencil',
    strategy = 'smart',
    budget = 1200,
    seed = 42,
    focus = [0.5, 0.4],
  } = settings;
  if (
    !['pencil', 'etch', 'wash'].includes(style) ||
    !['smart', 'random'].includes(strategy)
  )
    throw Error('Unknown drawing settings.');
  if (
    !Number.isInteger(budget) ||
    budget < 1 ||
    budget > 1600 ||
    !Number.isInteger(seed)
  )
    throw Error('Invalid budget or seed.');
  progress('observe', 0);
  const f = analyze(rgba, focus);
  progress('candidates', 0);
  const pool = buildCandidates(f, style, seed);
  progress('select', 0);
  return {
    ...select(f, pool, {
      budget,
      strategy,
      seed,
      progress: (n, t) => progress('select', n / t),
    }),
    settings: { style, strategy, budget, seed, focus },
  };
}
export function outline(s, scale = 1, offset = 0) {
  const p = s.points,
    left = [],
    right = [],
    count = p.length / 2;
  for (let i = 0; i < count; i++) {
    const a = Math.max(0, i - 1) * 2,
      b = Math.min(count - 1, i + 1) * 2,
      dx = p[b] - p[a],
      dy = p[b + 1] - p[a + 1],
      n = Math.hypot(dx, dy) || 1,
      w =
        (s.width *
          (0.3 +
            0.7 * Math.sin((Math.PI * i) / Math.max(1, count - 1)) ** 0.35)) /
        2;
    left.push([
      (p[i * 2] - (dy / n) * w) * scale + offset,
      (p[i * 2 + 1] + (dx / n) * w) * scale + offset,
    ]);
    right.push([
      (p[i * 2] + (dy / n) * w) * scale + offset,
      (p[i * 2 + 1] - (dx / n) * w) * scale + offset,
    ]);
  }
  return left.concat(right.reverse());
}
export function svg(result, count, ink = '#293533', paper = '#faf9f5') {
  const marks = result.strokes.slice(0, count);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><title>Sfumato · ${marks.length} selected strokes</title><rect width="1000" height="1000" fill="${paper}"/><defs>${marks
    .filter((s) => s.soft)
    .map(
      (s) =>
        `<filter id="s${s.id}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="${s.width * 0.32 * 5}"/></filter>`,
    )
    .join('')}</defs>${marks
    .map(
      (s) =>
        `<path d="M${outline(s, 5, 100)
          .map((p) => p.map((v) => v.toFixed(3)).join(','))
          .join(
            ' L',
          )} Z" fill="${ink}" style="mix-blend-mode:multiply" opacity="${(1 - Math.exp(-1.8 * s.alpha)).toFixed(5)}"${s.soft ? ` filter="url(#s${s.id})"` : ''}/>`,
    )
    .join('')}</svg>`;
}
