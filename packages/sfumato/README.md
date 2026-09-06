# Sfumato

[中文](README.zh-CN.md)

A JavaScript package that reconstructs a photograph from mathematical curves.

**How much math describes you?** Image → portrait + mathematical self-portrait card + a recipe that redraws without the photograph.

No runtime dependencies, image AI, API key, network requests, or DOM requirements. Works in Node.js and browsers. MIT licensed. This package has not been published to npm; use a local build or tarball.

## Use

```js
import { createPortrait, redraw } from '@shen-chenyu/sfumato';

// RGBA bytes, e.g. canvas.getImageData(...), or a decoded Node image.
const result = createPortrait({ data, width, height });

result.image;       // { data: Uint8ClampedArray, width: 160, height: 160 }
result.svg;         // editable vector curves (without the tonal field)
result.explanation; // short explanation based on the actual construction
result.recipe;      // JSON-serializable geometry, tone samples and settings
result.math;        // curves, coordinate polynomials, stored values, example equation
result.card;        // self-contained SVG math portrait card

// The original photograph is no longer needed.
const again = redraw(JSON.parse(JSON.stringify(result.recipe)));
```

Inputs may contain at most 50 megapixels, and `data` must be a `Uint8Array` or `Uint8ClampedArray` with exactly `width * height * 4` entries. The package accepts **decoded 8-bit RGBA pixels**, not JPEG/PNG files. Browsers can decode through canvas; in Node, use an image library such as Sharp. The core stays independent of codecs and frameworks. PNG encoding belongs to the caller. See the repository's `examples/node/portrait.mjs` for a complete image-file example.

## Mathematical profile scores

`result.math.scores` contains three 0–100 indices: `complexity.value`, `symmetry.value`, and `tone.value`. `scorePortrait(recipe)` calculates them without reconstructing the tone. The version is `sfumato-profile-1`; symmetry is `null` when no visible geometry is present.

- Complexity: `100 × ln(1 + cubicSegments) / ln(3001)`, using the supported 3,000-segment ceiling as a fixed reference.
- Composition symmetry: mirror-overlap of a lightly smoothed 64×64 subpixel curve mask, about the image centre. No face alignment is inferred.
- Tonal richness: the Shannon entropy of the 64 anchors in 16 grayscale bins, scaled by `100 / 4`.

The scores include raw segment count, occupied grid cells, tone histogram and entropy for inspection. They update from the recipe, remain identical across languages, and appear on the SVG card. These are fixed image indices, not population percentiles; crop, background, pose and fitting settings affect them.

## Your portrait, in numbers

`result.math` describes the actual recipe, including after editing and `redraw`:

- `cubicSegments`: how many cubic Bézier pieces describe the extracted boundaries.
- `coordinatePolynomials`: two per segment, for x(t) and y(t); not a count of every equation in the tone solver.
- `storedScalars`: stored control coordinates + curve tone samples + anchor coordinates and values. Shared endpoints are counted as stored, so this is not independent degrees of freedom.
- `recipeBytes`: actual UTF-8 size of the compact JSON recipe, including metadata. Separate from the scalar count.
- `example`: full-precision coefficients of a real segment in the recipe, highlighted in blue on the card, or `null` when no curves were extracted. The display chooses the longest approximately sampled non-straight segment, falling back to the longest segment; it does not identify anatomical significance.

`result.card` presents the curve drawing, counts and one real equation as a portable SVG. `toMathCard(recipe)` regenerates the card without decoding the photograph or solving the tonal field. `describeMath(recipe)` returns the statistics alone. Neither requires network access or image AI. Cards support the recipe's English/Chinese language setting. Displayed equation coefficients are rounded to three decimals; the recipe and `math.example` keep full precision.

These numbers belong to this image and this construction—not to the person's intrinsic complexity, beauty, or identity. They are not a claim of minimum description length or file compression. There is no recognition quiz or leaderboard.

In a browser with a module bundler:

```js
const result = createPortrait(sourceContext.getImageData(0, 0, width, height), {
  language: 'zh-CN',
});
outputCanvas.width = outputCanvas.height = 160;
outputCanvas.getContext('2d').putImageData(
  new ImageData(result.image.data, 160, 160), 0, 0,
);
```

## A few useful variations

```js
// Use a smaller subset of image-boundary chains.
createPortrait(image, { curves: 40 });

// Larger tolerance allows coarser cubic fitting.
createPortrait(image, { tolerance: 1.4 });

// Change a control handle, then solve the tone again.
const edited = structuredClone(result.recipe);
if (edited.construction.curves.length) {
  const segment = edited.construction.curves[0].segments[0];
  segment.controls[1][0] += 2;
  const variation = redraw(edited);
}
```

`createPortrait(image, options?)` supports:

| Option | Default | Meaning |
| --- | --- | --- |
| `curves` | all detected | Maximum boundary chains, 0–180. One chain can contain several cubic segments. |
| `tolerance` | `0.8` | Cubic fitting tolerance on the 160px grid, 0.15–4. |
| `iterations` | `500` | Maximum tone-solver iterations, 1–3000. Check `stats.converged`. |
| `language` | `'en'` | Explanation language: `'en'` or `'zh-CN'`. |

`redraw(recipe)` returns the same result structure, including a defensive copy of the recipe. Recipes exported by the browser demo can be passed directly to `redraw`, and package recipes can be imported into the demo. Original pixels are not stored. `toSVG(recipe, { size: 800 })` exports curve geometry at a requested display size. `bezier(controls, t)` and `polynomial(controls)` expose the actual cubic construction.

## What it does

1. Fit the image inside a 160×160 square, preserve aspect ratio, and composite transparency on white. Downsampling uses area averages; upsampling uses bilinear interpolation.
2. Trace brightness edges and fit piecewise cubic Bézier curves.
3. Store tone samples beside the curves and 64 coarse anchors.
4. Reconstruct the tone by solving a discrete harmonic field.

The current result is an image-space drawing, not anatomical or 3D reconstruction. SVG shows the curves; the RGBA image includes reconstructed tone. Larger SVG dimensions do not recover additional photographic detail. The demo and package share the same preprocessing and API. Browser image codecs can differ; JSON replay with the same package and settings is deterministic. Run CPU-heavy work in a Web Worker for responsive browser applications.

## Build from the repository

From the repository root, with Node 22:

```sh
npm run package:build
npm run package:pack
```

The archive is written to `shen-chenyu-sfumato-0.1.0.tgz` in the repository root; install that local file in another project. The package build itself uses only Node built-ins and copies the same engine used by the browser demo. The website's React/Vite dependencies are not included in the package.
