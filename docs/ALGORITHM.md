# A drawing as a sequence of decisions

The input is a photograph composited on white and fitted into a 160 × 160 square. The output is a sequence of vector marks, not a filtered copy of the photograph. All sampling uses ordinary image arithmetic; there is no learned model, landmark detector, or external inference call.

## 1. Where a curve can go

Luminance is smoothed at two scales. Central differences give image derivatives. A smoothed structure tensor records local gradient directions:

```
J = blur([ Ix²  IxIy
           IxIy Iy²  ])
```

The tangent is stored as a double-angle vector, so a direction and its opposite are equivalent. Tensor anisotropy and gradient strength control how strongly it influences a gentle diagonal prior. This keeps almost-flat regions from turning sensor noise into decorative swirls. Streamlines follow the resulting unoriented field, choosing the sign consistent with the previous step.

Seeded jitter gives a reproducible grid of candidate starting points. Different lengths and widths make different mark families. The default graphite hand uses short tapered curves; soft ink adds broad, Gaussian-like strokes. Fine masks and 4 × 4 averaged masks are sparse arrays. Very light areas generate no candidates.

## 2. What a mark is trying to explain

The target combines tone, positive local dark detail, and edge strength at the fine scale, plus broad tone at 40 × 40 resolution. A smooth attention weight makes errors near the user-selected point more expensive. It is a manual attention point, not inferred eyes or a claim about a person's identity.

Let `t` be the concatenated target, `W` its positive diagonal weights, and `m_j` a candidate mark. The residual after the selected marks is:

```
r = t − Σ α_j m_j
L = rᵀ W r
```

For a candidate, compute its best nonnegative, capped coefficient and penalized benefit:

```
α = clamp((mᵀ W r) / (mᵀ W m), 0, 0.95)
reduction = 2α mᵀ W r − α² mᵀ W m
gain = reduction − 0.004 × (1 + number_of_points / 30)
```

Keep the candidate with the greatest positive gain. Its mask is subtracted from the residual. Continue until the stroke budget is reached or no useful candidate remains. The displayed error does not include the complexity penalty; the selection gain does.

Because every mask and coefficient is nonnegative and previous coefficients stay fixed, residuals only decrease componentwise. A cached benefit is therefore an upper bound on its current value. A max heap can lazily reevaluate candidates and still perform greedy selection, to floating-point tolerance. A test checks the chosen sequence against exhaustive search and independently recomputes the residual loss.

The random baseline shuffles the same dictionary with a fixed seed and evaluates candidates in that order. It still optimizes each coefficient and rejects negative gains. It is not uniform random drawing or a guarantee that greedy selection wins at every budget.

## 3. The drawing you see

Selected centerlines become tapered ribbon polygons. Opacity maps optical density through `1 − exp(−1.8α)`. The canvas and SVG use multiply blending; soft marks are blurred. The objective's sampled masks and the vector renderer are approximations of each other, not pixel-identical representations. A lower numerical loss does not prove that a rendered portrait looks better.

A recipe contains the engine version, settings, chosen points and coefficients, per-stroke reductions, the stopping point, and a plain-language explanation. It deliberately excludes the source photograph. The stored curves can redraw the result without the photograph; re-running selection requires the same input pixels and settings. Browser image decoding/resizing may differ slightly across devices. There is no cross-browser bit-identical PNG promise.

Unlike the prior Python research prototype, this browser implementation does not refit or delete old strokes. That choice makes playback and rewinding exact at the level of the selected vector sequence.

## Limits and next experiments

The engine has no anatomy, depth, pose, material, or expression model. A close portrait usually works better than a small face in a busy scene. The 160-pixel analysis grid can miss subtle eyes and mouths. Backgrounds can consume marks, curved lines can still become patterns, and washes can obscure details. Good future changes should improve those failures, not just reduce the same proxy error.

Promising experiments: a contour-specific dictionary, multi-resolution candidates concentrated around important features, explicit negative-space costs, and a model of consistent surface hatching. Compare results at a fixed budget, show failures, and distinguish measured error from human preference.
