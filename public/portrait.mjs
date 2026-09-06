import {
  construct,
  reconstruct,
  validateConstruction,
  polynomial,
  bezier,
} from './construct-engine.mjs';
import { SIZE } from './engine.mjs';
export { bezier, polynomial } from './construct-engine.mjs';

const VERSION = 'sfumato-recipe-1';

function prepareImage({ data, width, height } = {}) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 50_000_000 ||
    !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) ||
    data.length !== width * height * 4
  ) {
    throw new TypeError(
      'Expected 8-bit RGBA pixels with width and height (at most 50 megapixels).',
    );
  }
  const scale = SIZE / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const left = Math.floor((SIZE - w) / 2),
    top = Math.floor((SIZE - h) / 2);
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255);
  const color = (x, y, channel) => {
    const i = (y * width + x) * 4;
    return 255 + ((data[i + channel] - 255) * data[i + 3]) / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const out = ((y + top) * SIZE + x + left) * 4;
      if (scale <= 1) {
        // Area averaging suppresses aliasing during downsampling. Composite
        // transparency before averaging so hidden RGB cannot create dark edges.
        const x0 = (x * width) / w,
          x1 = ((x + 1) * width) / w;
        const y0 = (y * height) / h,
          y1 = ((y + 1) * height) / h;
        const sum = [0, 0, 0];
        for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
          const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
          for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
            const weight = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
            for (let c = 0; c < 3; c++) sum[c] += color(sx, sy, c) * weight;
          }
        }
        for (let c = 0; c < 3; c++)
          pixels[out + c] = sum[c] / ((x1 - x0) * (y1 - y0));
      } else {
        const sx = Math.max(
          0,
          Math.min(width - 1, ((x + 0.5) * width) / w - 0.5),
        );
        const sy = Math.max(
          0,
          Math.min(height - 1, ((y + 0.5) * height) / h - 0.5),
        );
        const ix = Math.floor(sx),
          iy = Math.floor(sy),
          u = sx - ix,
          v = sy - iy;
        const nx = Math.min(ix + 1, width - 1),
          ny = Math.min(iy + 1, height - 1);
        for (let c = 0; c < 3; c++) {
          pixels[out + c] =
            (1 - v) * ((1 - u) * color(ix, iy, c) + u * color(nx, iy, c)) +
            v * ((1 - u) * color(ix, ny, c) + u * color(nx, ny, c));
        }
      }
    }
  }
  return pixels;
}

function checkedRecipe(recipe) {
  if (
    !recipe ||
    recipe.version !== VERSION ||
    !recipe.render ||
    !Number.isInteger(recipe.render.iterations) ||
    recipe.render.iterations < 1 ||
    recipe.render.iterations > 3000 ||
    !Number.isFinite(recipe.render.tolerance) ||
    recipe.render.tolerance <= 0 ||
    recipe.render.tolerance > 1 ||
    !['en', 'zh-CN'].includes(recipe.language)
  ) {
    throw new TypeError('Unsupported or invalid Sfumato recipe.');
  }
  validateConstruction(recipe.construction);
  return recipe;
}

/** Generate a self-contained recipe and portrait from decoded image pixels. */
export function createPortrait(
  image,
  { tolerance = 0.8, curves, language = 'en', iterations = 500 } = {},
) {
  if (
    curves !== undefined &&
    (!Number.isInteger(curves) || curves < 0 || curves > 180)
  ) {
    throw new RangeError('curves must be an integer between 0 and 180.');
  }
  if (
    !['en', 'zh-CN'].includes(language) ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 3000
  ) {
    throw new TypeError(
      'Use language en or zh-CN and 1..3000 solver iterations.',
    );
  }
  const construction = construct(prepareImage(image), { tolerance });
  if (curves !== undefined)
    construction.curves = construction.curves.slice(0, curves);
  return redraw({
    version: VERSION,
    construction,
    render: { iterations, tolerance: 1e-5 },
    language,
  });
}

/** Reconstruct without the source photograph, including after editing curves. */
export function redraw(input) {
  const recipe = structuredClone(checkedRecipe(input));
  const { pixels, stats } = reconstruct(recipe.construction, recipe.render);
  const math = measureRecipe(recipe);
  const paths = curvePaths(recipe.construction);
  const explanation = math.summary;
  return {
    image: { data: pixels, width: SIZE, height: SIZE },
    recipe,
    stats,
    explanation,
    math,
    svg: renderSVG(paths, 800),
    card: renderMathCard(recipe, math, paths),
  };
}

function curvePaths(construction) {
  const point = (p) => p.map((n) => Number(n.toFixed(5))).join(' ');
  return construction.curves
    .map((curve) => {
      const d = curve.segments
        .map(
          ({ controls: p }) =>
            `M ${point(p[0])} C ${point(p[1])} ${point(p[2])} ${point(p[3])}`,
        )
        .join(' ');
      return `<path d="${d}"/>`;
    })
    .join('\n');
}

/** An editable vector drawing of the curves; tonal reconstruction is in image. */
export function toSVG(input, { size = 800 } = {}) {
  const { construction } = checkedRecipe(input);
  if (!Number.isInteger(size) || size < 1 || size > 8192)
    throw new RangeError('SVG size must be 1..8192.');
  const paths = curvePaths(construction);
  return renderSVG(paths, size);
}

function renderSVG(paths, size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${SIZE} ${SIZE}"><title>Sfumato curve construction</title><rect width="${SIZE}" height="${SIZE}" fill="#faf9f6"/><g fill="none" stroke="#292d31" stroke-width="0.22" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
}

/** A count of this construction, not a measure of a person's complexity. */
export function describeMath(input) {
  return measureRecipe(checkedRecipe(input));
}

/** Versioned image-construction indices on a fixed 0..100 scale. */
export function scorePortrait(input) {
  return measureScores(checkedRecipe(input).construction);
}

function measureScores(construction) {
  const gridSize = 64,
    mask = new Float64Array(gridSize * gridSize);
  const scale = (gridSize - 1) / (SIZE - 1);
  let segments = 0;
  for (const curve of construction.curves)
    for (const segment of curve.segments) {
      segments++;
      const p = segment.controls;
      let polygonLength = 0;
      for (let i = 1; i < 4; i++)
        polygonLength += Math.hypot(
          p[i][0] - p[i - 1][0],
          p[i][1] - p[i - 1][1],
        );
      // Oversample relative to the control polygon to avoid gaps on long segments.
      const steps = Math.max(8, Math.ceil(polygonLength * scale * 2));
      for (let i = 0; i <= steps; i++) {
        const [x, y] = bezier(p, i / steps);
        if (x < 0 || y < 0 || x > SIZE - 1 || y > SIZE - 1) continue;
        const gx = x * scale,
          gy = y * scale;
        const ix = Math.floor(gx),
          iy = Math.floor(gy);
        // Subpixel coverage preserves the axis between the two middle columns.
        // Nearest-cell rounding would make a centred line asymmetric.
        for (let dy = 0; dy <= 1; dy++)
          for (let dx = 0; dx <= 1; dx++) {
            if (ix + dx >= gridSize || iy + dy >= gridSize) continue;
            const coverage =
              (dx ? gx - ix : 1 - gx + ix) * (dy ? gy - iy : 1 - gy + iy);
            if (coverage > 1e-12) {
              const k = (iy + dy) * gridSize + ix + dx;
              mask[k] = Math.max(mask[k], coverage);
            }
          }
      }
    }
  // A one-cell [1,2,1] separable blur gives near-matching boundaries partial
  // credit. The mirror axis is the image centre; no face alignment is inferred.
  const smooth = new Float64Array(mask.length),
    kernel = [1, 2, 1];
  let occupiedCells = 0,
    mass = 0;
  for (let y = 0; y < gridSize; y++)
    for (let x = 0; x < gridSize; x++) {
      const k = y * gridSize + x;
      occupiedCells += Number(mask[k] > 0);
      let value = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < gridSize && ny < gridSize)
            value +=
              (mask[ny * gridSize + nx] * kernel[dx + 1] * kernel[dy + 1]) / 16;
        }
      smooth[k] = value;
      mass += value;
    }
  let overlap = 0;
  for (let y = 0; y < gridSize; y++)
    for (let x = 0; x < gridSize; x++)
      overlap += Math.min(
        smooth[y * gridSize + x],
        smooth[y * gridSize + gridSize - 1 - x],
      );
  const histogram = Array.from({ length: 16 }, () => 0);
  for (const anchor of construction.anchors)
    histogram[Math.min(15, Math.floor(anchor.value * 16))]++;
  let entropyBits = 0;
  for (const count of histogram)
    if (count) {
      const p = count / construction.anchors.length;
      entropyBits -= p * Math.log2(p);
    }
  const score = (value) =>
    Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
  return {
    version: 'sfumato-profile-1',
    complexity: {
      value: score((100 * Math.log1p(segments)) / Math.log1p(3000)),
      segments,
    },
    symmetry: {
      value: mass ? score((100 * overlap) / mass) : null,
      axis: (SIZE - 1) / 2,
      gridSize,
      occupiedCells,
    },
    tone: { value: score((100 * entropyBits) / 4), entropyBits, histogram },
  };
}

function measureRecipe(recipe) {
  const { construction } = recipe;
  const segments = construction.curves.flatMap((curve) => curve.segments);
  const cubicSegments = segments.length;
  const geometryScalars = segments.reduce(
    (sum, s) => sum + s.controls.flat().length,
    0,
  );
  const curveToneSamples = segments.reduce(
    (sum, s) => sum + s.tones.flat().length,
    0,
  );
  const toneAnchors = construction.anchors.length;
  const anchorScalars = toneAnchors * 3; // x, y, tone; not metadata or independent DOF.
  const storedScalars = geometryScalars + curveToneSamples + anchorScalars;
  // Show a substantial curved segment, with a longest-segment fallback for
  // straight-only inputs. This is a display choice, not anatomical importance.
  let selected = null,
    bestLength = -1,
    hasCurved = false;
  for (const curve of construction.curves)
    for (const [index, segment] of curve.segments.entries()) {
      let length = 0,
        previous = segment.controls[0];
      for (let i = 1; i <= 16; i++) {
        const point = bezier(segment.controls, i / 16);
        length += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
        previous = point;
      }
      const [start, , , end] = segment.controls;
      const curved =
        length - Math.hypot(end[0] - start[0], end[1] - start[1]) > 0.05;
      if (
        (curved && !hasCurved) ||
        (curved === hasCurved && length > bestLength)
      ) {
        selected = {
          curveId: curve.id,
          segment: index,
          controls: segment.controls,
        };
        bestLength = length;
        hasCurved = curved;
      }
    }
  const [x, y] = selected ? polynomial(selected.controls) : [null, null];
  const scores = measureScores(construction);
  const summary =
    recipe.language === 'zh-CN'
      ? cubicSegments
        ? `这张照片里的你，被写成了 ${cubicSegments} 段三次 Bézier 曲线、${toneAnchors} 个明暗锚点。配方保存 ${storedScalars.toLocaleString('en-US')} 个几何与明暗数值，就能在不读取原照片的情况下重画这幅肖像。`
        : `这张图没有提取出边界曲线。它由 ${toneAnchors} 个明暗锚点、${storedScalars} 个几何与明暗数值重建。`
      : cubicSegments
        ? `You, in ${cubicSegments} cubic Bézier segments and ${toneAnchors} tone anchors. ${storedScalars.toLocaleString('en-US')} stored geometry and tone values redraw this portrait without the original photograph.`
        : `No boundary curves were extracted. This image is reconstructed from ${toneAnchors} tone anchors and ${storedScalars} stored geometry and tone values.`;
  return {
    boundaryChains: construction.curves.length,
    cubicSegments,
    coordinatePolynomials: cubicSegments * 2,
    geometryScalars,
    curveToneSamples,
    toneAnchors,
    anchorScalars,
    storedScalars,
    recipeBytes: new TextEncoder().encode(JSON.stringify(recipe)).length,
    scores,
    example: selected
      ? { curveId: selected.curveId, segment: selected.segment, x, y }
      : null,
    summary:
      summary +
      (recipe.language === 'zh-CN'
        ? ` 数学画像评分：复杂度 ${scores.complexity.value}/100，构图对称度 ${scores.symmetry.value === null ? '暂无数据' : scores.symmetry.value + '/100'}，明暗丰富度 ${scores.tone.value}/100。评分针对当前图像构造，采用固定尺度。`
        : ` Mathematical profile: complexity ${scores.complexity.value}/100, composition symmetry ${scores.symmetry.value === null ? 'unavailable' : scores.symmetry.value + '/100'}, tonal richness ${scores.tone.value}/100. Fixed-scale indices of the current image construction.`),
  };
}

function expression(coefficients) {
  return coefficients
    .map((value, i) => {
      const rounded = Number(value.toFixed(3));
      const sign =
        i === 0 ? (rounded < 0 ? '−' : '') : rounded < 0 ? ' − ' : ' + ';
      return sign + Math.abs(rounded) + ['', 't', 't²', 't³'][i];
    })
    .join('');
}

/** A self-contained vector math portrait: actual curves, counts and an equation. */
export function toMathCard(input) {
  const recipe = checkedRecipe(input);
  return renderMathCard(
    recipe,
    measureRecipe(recipe),
    curvePaths(recipe.construction),
  );
}

function renderMathCard(recipe, math, paths) {
  const zh = recipe.language === 'zh-CN';
  const title = zh ? '多少数学，能描绘你？' : 'How much math describes you?';
  const subtitle = zh
    ? '一张照片，一份可以重画的数学自画像。'
    : 'One photograph. A mathematical self-portrait you can redraw.';
  const number = (n) => n.toLocaleString('en-US');
  const labels = zh
    ? ['段三次曲线', '个明暗锚点', '个保存数值', '蓝色曲线的真实方程']
    : [
        'cubic segments',
        'tone anchors',
        'stored values',
        'THE EQUATION OF THE BLUE CURVE',
      ];
  const rows = [
    [
      zh ? '数学复杂度' : 'Mathematical complexity',
      math.scores.complexity.value,
    ],
    [zh ? '构图对称度' : 'Composition symmetry', math.scores.symmetry.value],
    [zh ? '明暗丰富度' : 'Tonal richness', math.scores.tone.value],
  ]
    .map(([label, value], i) => {
      const y = 245 + i * 59;
      return `<text x="612" y="${y}" font-size="16">${label}</text>
<text x="1080" y="${y}" text-anchor="end" font-size="26" fill="#254edb">${value === null ? '—' : value.toFixed(1)}</text>
<rect x="612" y="${y + 12}" width="468" height="5" rx="2.5" fill="#e4e7eb"/>
${value === null ? '' : `<rect x="612" y="${y + 12}" width="${(468 * value) / 100}" height="5" rx="2.5" fill="#254edb"/>`}`;
    })
    .join('');
  const highlighted = math.example
    ? curvePaths({
        curves: [
          {
            segments: [
              recipe.construction.curves.find(
                (c) => c.id === math.example.curveId,
              ).segments[math.example.segment],
            ],
          },
        ],
      })
    : '';
  const equation = math.example
    ? `<text x="612" y="490">x(t) = ${expression(math.example.x)}</text><text x="612" y="516">y(t) = ${expression(math.example.y)}</text>`
    : `<text x="612" y="490">${zh ? '未提取出边界曲线' : 'No boundary curves extracted'}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="688" viewBox="0 0 1120 688">
<title>${title}</title><desc>${math.summary}</desc>
<rect width="1120" height="688" fill="#f8f8f5"/>
<g font-family="Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif" fill="#232930">
<text x="40" y="43" font-size="15" letter-spacing="2">SFUMATO / MATH PORTRAIT</text>
<text x="40" y="97" font-size="36">${title}</text>
<text x="40" y="131" font-size="16" fill="#626b74">${subtitle}</text>
<path d="M40 155 H1080" stroke="#d5d9dd"/>
<rect x="40" y="177" width="520" height="456" fill="#ffffff"/>
<svg x="72" y="177" width="456" height="456" viewBox="0 0 160 160">
<g fill="none" stroke="#35444f" stroke-width="0.28" stroke-linecap="round" stroke-linejoin="round">${paths}</g>
<g fill="none" stroke="#254edb" stroke-width="0.7" stroke-linecap="round">${highlighted}</g></svg>
<text x="612" y="201" font-size="13" letter-spacing="1" fill="#626b74">${zh ? '数学画像评分' : 'MATHEMATICAL PROFILE'}</text>
<text x="1080" y="201" text-anchor="end" font-size="13" fill="#626b74">0–100</text>
${rows}
${[math.cubicSegments, math.toneAnchors, math.storedScalars].map((value, i) => `<text x="${612 + i * 160}" y="414" font-size="22">${number(value)}</text><text x="${612 + i * 160}" y="435" font-size="12" fill="#626b74">${labels[i]}</text>`).join('')}
<text x="612" y="456" font-size="13" fill="#626b74">${math.example ? labels[3] : ''}</text>
<g font-family="'Courier New', monospace" font-size="12">${equation}</g>
<text x="612" y="549" font-size="13" fill="#626b74">${math.example ? (zh ? '0 ≤ t ≤ 1 · 显示系数保留三位小数' : '0 ≤ t ≤ 1 · display coefficients rounded to 3 decimals') : ''}</text>
<text x="612" y="605" font-size="14">${zh ? '保存配方，就能重新画出这幅肖像。' : 'Save the recipe. Redraw the portrait.'}</text>
<text x="40" y="666" font-size="13" fill="#626b74">${zh ? '评分为固定尺度的图像构造指数；姿态、背景和裁剪会改变结果。计数包含重复坐标。' : 'Fixed-scale image indices; pose, background and cropping affect scores. Stored counts include repeated coordinates.'}</text>
</g></svg>`;
}
