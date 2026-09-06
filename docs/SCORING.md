# Mathematical profile / 数学画像评分

The `sfumato-profile-1` model assigns three fixed-scale indices to a recipe. All values come from its actual geometry and tone anchors; no face model, population database, random value or image AI is used. Scores are reproducible from recipe JSON alone and update after editing. They are rounded to one decimal place.

`sfumato-profile-1` 为配方计算三个固定尺度的指标。所有数值来自真实曲线与明暗锚点，不使用人脸模型、人群数据库、随机数或图像 AI。只用配方 JSON 就能重新计算，编辑后随构造更新，保留一位小数。

## Mathematical complexity / 数学复杂度

For N cubic segments:

```
C = 100 × ln(1 + N) / ln(3001)
```

This logarithmic representation-size index is 0 for an empty construction and 100 at the supported maximum of 3,000 segments. The logarithmic scale and upper reference are explicit design choices. This is not minimum description length or a count of independent parameters. A higher score describes a more elaborate curve representation; fitting tolerance and retained boundaries affect it.

N 为三次曲线段数。没有曲线时为 0 分，达到当前支持上限 3000 段时为 100 分。对数尺度与上限参考值是明确的设计选择；它不是最短描述长度，也不是独立参数数量。更高的分数表示曲线描述更繁复，拟合容差和保留的边界数量都会影响它。

## Composition symmetry / 构图对称度

1. Sample each curve at `max(8, ceil(controlPolygonLength × 63/159 × 2))` steps on a 64×64 grid. Discard samples outside the 160×160 image.
2. Deposit bilinear subpixel coverage, taking the maximum contribution at each cell. Contributions below 1e−12 are ignored. This handles the centre axis between the two central columns without rounding it to one side.
3. Convolve with `[1,2,1]ᵀ [1,2,1] / 16`, using zero outside the grid, to produce M.
4. Reflect M horizontally about the fixed image centre, x = 79.5 analysis pixels, to obtain R.

```
S = 100 × Σ min(M, R) / Σ M
```

Perfect mirror overlap gives 100. No visible geometry gives `null`, displayed as unavailable. The softened comparison gives nearby boundaries partial credit. It evaluates the full composition, including background, with no face detection, pose correction or recentering. A dense texture can also be symmetric; symmetry alone does not imply a more attractive portrait.

逐段采样到 64×64 网格，采用双线性亚像素覆盖，并对同一格取最大贡献；随后以 `[1,2,1]` 核轻度平滑，比较它与围绕画面中轴的左右镜像。完全重合为 100 分，没有可见几何时返回 `null`，显示“暂无数据”。它衡量整张画面的边界分布，包含背景；不做人脸检测、姿态校正或自动居中。密集纹理也可能很对称，因此对称度本身不意味着肖像更好看。

## Tonal richness / 明暗丰富度

Assign the 64 tone-anchor values to 16 equal-width grayscale bins with `min(15, floor(value × 16))`. For bin probabilities p:

```
H = −Σ p × log₂(p)
T = 100 × H / 4
```

An empty bin contributes zero. A single tone gives 0; two equally populated bins give 25; uniform occupancy of all 16 bins gives 100. The result measures grayscale diversity at the coarse anchors, not detail resolution, perceptual quality or the curve-side sample count. `histogram` and `entropyBits` expose the underlying measurement. Editing only curve coordinates leaves this score unchanged because anchor tones have not changed.

将 64 个明暗锚点分入 16 个等宽灰度档，计算 Shannon 熵 H，分数为 `100 × H / 4`。单一灰度为 0 分，两档均匀分布为 25 分，16 档均匀分布为 100 分。它衡量粗网格上的灰度多样性，不衡量细节分辨率或审美质量。`histogram` 和 `entropyBits` 提供计算依据。仅移动曲线控制点不会改变锚点灰度，因此这项分数保持不变。

## API and interpretation / API 与解释

```js
import { createPortrait, scorePortrait } from '@shen-chenyu/sfumato';
const portrait = createPortrait(image);
portrait.math.scores;                 // all three indices and raw measurements
const scores = scorePortrait(recipe); // without solving the tonal image
scores.version;                      // 'sfumato-profile-1'
```

The card and browser show the same scores. Language changes do not alter them. The values are fixed indices, not percentiles or statistically calibrated beauty scores. Compare images using the same crop, lighting, fitting settings and model version. There is no overall attractiveness score: combining these independent axes would require additional, subjective weights.

卡片与网页展示同一份评分，切换语言不改变分数。数值是固定尺度的指标，不是人群百分位或经过统计校准的颜值分数。比较图片时应使用一致的裁剪、光照、拟合设置与评分版本。三个维度分别展示；没有把它们用主观权重拼成总颜值分。
