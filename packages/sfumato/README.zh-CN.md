# Sfumato

[English](README.md)

**多少数学，能描绘你？**

一个 JavaScript package：输入照片像素，输出数学自画像、真实方程和可以重新绘制的配方。没有运行时依赖、图像 AI、网络请求或 DOM 要求，可用于 Node.js 和浏览器。MIT 开源协议。目前尚未发布到 npm，请从仓库构建本地安装包。

## 开始使用

```js
import { createPortrait, redraw } from '@shen-chenyu/sfumato';

const portrait = createPortrait({ data, width, height }, {
  language: 'zh-CN',
});

portrait.image;       // 160×160 RGBA 明暗重建图
portrait.svg;         // 可编辑的曲线 SVG，不包含明暗场
portrait.card;        // 包含肖像、实际计数和方程的独立 SVG 卡片
portrait.explanation; // 根据实际构造生成的说明
portrait.math;        // 曲线、坐标多项式、保存数值数量与示例方程
portrait.recipe;      // 可序列化为 JSON 的曲线、明暗采样和设置
portrait.stats;       // 求解迭代次数、残差和是否达到停止阈值

const restored = redraw(JSON.parse(JSON.stringify(portrait.recipe)));
```

输入是解码后的 **8 位 RGBA 像素**，不是 JPG/PNG 文件或文件路径。`data` 为 `Uint8Array` 或 `Uint8ClampedArray`，长度必须等于 `width * height * 4`；图片最多 5000 万像素。浏览器可用 Canvas 解码，Node 示例使用 Sharp。核心 package 不附带图片编解码器。

## 数学画像评分

`portrait.math.scores` 提供三个 0–100 指标：`complexity.value`（数学复杂度）、`symmetry.value`（构图对称度）、`tone.value`（明暗丰富度）。也可以调用 `scorePortrait(recipe)`，不用重建明暗图就得到评分。

- 复杂度：`100 × ln(1 + 曲线段数) / ln(3001)`，以当前支持上限 3000 段为固定参考。
- 对称度：曲线投到 64×64 亚像素覆盖网格，轻度平滑后比较与画面中轴左右镜像的重合程度；没有可见曲线时返回 `null`。
- 明暗丰富度：64 个明暗锚点分成 16 档灰度，计算 Shannon 熵 H，分数为 `100 × H / 4`。

评分版本为 `sfumato-profile-1`，附带曲线段数、有效网格数、灰度直方图和熵作为依据。网页、卡片和 package 使用同样的计算，语言切换不改变分数。它们是图像指标，不是人群百分位；姿态、背景、裁剪和拟合设置会影响结果。

## 数字具体指什么

| 字段 | 含义 |
| --- | --- |
| `boundaryChains` | 保留的图像边界数量，一条边界可有多段曲线。 |
| `cubicSegments` | 三次 Bézier 曲线段数。 |
| `coordinatePolynomials` | 每段曲线的 x(t)、y(t)，共两条；不包括明暗求解方程。 |
| `geometryScalars` | 曲线控制点坐标的保存数量，每段 8 个。 |
| `curveToneSamples` | 曲线两侧的明暗采样，每段 6 个。 |
| `toneAnchors` / `anchorScalars` | 明暗锚点数量 / 其坐标和明暗数值数量，通常为 64 / 192。 |
| `storedScalars` | 所有保存的几何与明暗数值，包含重复端点。 |
| `recipeBytes` | 含元数据的紧凑 JSON 配方的实际 UTF-8 字节数。 |
| `example` | 真实曲线段的完整精度多项式系数；没有曲线时为 `null`。 |

卡片用蓝色标出示例曲线。展示选择近似弧长最大的非直线段；全为直线时选最长段。这只是展示规则，不是解剖学重要性判断。显示系数保留三位小数，配方和 `math.example` 保留完整精度。

计数描述的是这张图片和这份配方，不衡量一个人的复杂度、颜值或身份。保存数量不等于独立自由度，也不代表最短描述或文件压缩率。

## 参数与编辑

| `createPortrait` 参数 | 默认值 | 范围与用途 |
| --- | --- | --- |
| `curves` | 所有检出的边界 | 整数 0–180；限制边界链数量，不是曲线段数。 |
| `tolerance` | `0.8` | 0.15–4；160px 分析网格上的拟合容差，越大通常越简略。 |
| `iterations` | `500` | 整数 1–3000；明暗求解的迭代上限，查看 `stats.converged`。 |
| `language` | `'en'` | `'en'` 或 `'zh-CN'`，决定卡片与说明语言。 |

```js
const edited = structuredClone(portrait.recipe);
if (edited.construction.curves.length) {
  edited.construction.curves[0].segments[0].controls[1][0] += 2;
  const variation = redraw(edited);
}
```

`redraw(recipe)` 返回同样的结果结构，并保留独立的配方副本。重新绘制只需要配方，不需要原照片。网页与 package 使用同一个入口，网页导出的配方可以直接传给 `redraw`；package 配方也可以导入网页。

其他导出：`toSVG(recipe, { size: 800 })`（尺寸整数 1–8192）、`toMathCard(recipe)`、`describeMath(recipe)`、`bezier(controls, t)` 和 `polynomial(controls)`。前两者分别生成纯曲线图和数学卡片，后三者提供真实计数与几何计算。生成卡片或读取计数不需要重新求解明暗场。

浏览器使用示例（需要模块打包器）：

```js
const portrait = createPortrait(ctx.getImageData(0, 0, width, height), {
  language: 'zh-CN',
});
outputCanvas.width = outputCanvas.height = 160;
outputCanvas.getContext('2d').putImageData(
  new ImageData(portrait.image.data, 160, 160), 0, 0,
);
```

API 是同步计算。正式浏览器界面应像仓库示例一样放入 Web Worker，以免阻塞交互。

## 算法与边界

图片先按原比例放入 160×160 画布，透明部分与留白合成白色。缩小用面积平均，放大用双线性插值；随后提取亮度边缘、连接边界链，用分段三次 Bézier 曲线拟合。曲线两侧的明暗采样与 64 个粗网格锚点形成约束，离散调和场求解重建明暗。

这是二维图像构造，不是人体解剖分析或真实三维恢复。更大的 SVG 显示尺寸不会增加原图细节。不同图片解码器可能产生细微差异；相同像素与设置的构造可复现，相同配方可以不读原照片重画。配方本身仍能呈现照片内容。

## 从仓库构建

在仓库根目录，用 Node 22 运行：

```sh
npm run package:pack
```

生成 `shen-chenyu-sfumato-0.1.0.tgz`，在另一个项目中用 `npm install /绝对路径/shen-chenyu-sfumato-0.1.0.tgz` 安装。构建只使用 Node 内置功能，不需要安装网站依赖。仓库的 `examples/node/portrait.mjs` 提供读取照片并导出 PNG、SVG、JSON、说明的完整例子。
