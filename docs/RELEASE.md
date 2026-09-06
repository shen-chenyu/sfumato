# Sfumato 0.1.0 / 版本说明

## Included / 本版内容

Sfumato 0.1.0 includes a dependency-free JavaScript package, a bilingual browser demo, and an optional Node image-file adapter. The core turns decoded RGBA pixels into a curve portrait, a tone reconstruction, an explanation and a replayable mathematical recipe.

Sfumato 0.1.0 包含：无运行时依赖的 JavaScript 包、中英文浏览器演示，以及可选的 Node 图片文件适配示例。核心输出曲线肖像、明暗重建、解释和可重画的数学配方。

CI checks code on push and pull request. GitHub Pages requires a separate manual workflow dispatch; npm publication is also separate.

推送和 PR 会运行 CI 检查。GitHub Pages 仅能单独手动触发，npm 发布也独立进行。

## Verification / 验证记录

Reviewed locally on macOS with Node 22. The package advertises Node 18+ compatible APIs; older Node releases and all browser engines have not been exercised locally.

本地验证环境为 macOS / Node 22。包使用兼容 Node 18+ 的接口，但本地没有逐一验证旧版 Node 或全部浏览器内核。

- 26 engine, package, profile and worker tests; TypeScript and lint checks.
- Root and `/sfumato` static builds, including emitted worker/module files.
- Fresh tarball install without website dependencies or install scripts; strict TypeScript import; JSON replay.
- Node example in both languages: PNG, SVG, recipe JSON, math JSON and explanation outputs. Generated card visually inspected.
- Desktop, 390px and 320px browser layouts; language switch, original view, control-point change and undo; legacy construction JSON import. No horizontal document overflow at 320px.
- Browser tonal PNG was found on disk and matched the package output pixel-for-pixel, including when exported from the Original tab. The mathematical card PNG was also saved and visually checked; SVG and recipe downloads were exercised.

对应验证：26 项数值、package、评分和 worker 测试，类型与代码检查；根路径和仓库子路径静态构建；独立安装包及类型导入；中英文文件示例；桌面和窄屏排版、语言切换、原图、控制点编辑与撤销、旧配方导入。浏览器保存的明暗 PNG 已在磁盘上找到，与 package 输出逐像素一致；数学卡片 PNG 也已保存并完成视觉检查，SVG 与配方下载均已操作验证。

## Numerical optimization / 数值优化

Cached harmonic neighbour stencils preserve the original red/black update order. A photo, a synthetic disk and a uniform image were compared against the previous solver at three curve budgets: pixels and solver statistics matched exactly. A checked-in regression fixture covers the disk at sparse/dense budgets and short/full iteration limits. Curve ranking now precedes fitting; card generation reuses measured counts and paths.

缓存调和求解的邻接关系，保持原有红黑更新顺序。照片、圆形合成图和纯色图在三种边界数量下与旧算法逐像素、逐统计对照一致；回归用例保存了圆形输入在不同预算和迭代上限下的参考结果。同时把边界排序移到拟合前，并复用卡片计数和路径。

One local microbenchmark (3 warmups, 8 timed solves per input) measured photo reconstruction at 44.0 → 24.6 ms, disk at 44.6 → 28.1 ms, and uniform at 3.5 → 0.5 ms. These are local measurements, not a cross-device performance guarantee.

一次本机测量（预热 3 次、计时 8 次）得到照片 44.0 → 24.6 ms、圆形 44.6 → 28.1 ms、纯色 3.5 → 0.5 ms。它们是本机结果，不是跨设备性能承诺。

## Dependency review / 依赖审查

On 2026-09-06, the example adapter was updated to Sharp 0.35.4 and the website's affected React, Vinext, Vite and Cloudflare tooling dependencies were updated with their compatible peers. Installation reported **0 known vulnerabilities** for both dependency trees. This is a dated registry audit result, not a guarantee against future advisories. The standalone package has no runtime dependency tree.

2026-09-06 已将文件示例更新为 Sharp 0.35.4，并同步更新网页受影响的 React、Vinext、Vite、Cloudflare 工具链及配套依赖。两个依赖树的安装审计均报告 **0 个已知漏洞**。这是当前审计结果，不代表未来不会出现公告。独立 package 没有运行时依赖。

## Package and publication / 安装包与后续发布

```sh
npm run package:pack
# shen-chenyu-sfumato-0.1.0.tgz
```

The archive contains 8 files, approximately 24 KB: the API and engines, declarations, English/Chinese README, package metadata and MIT license. It excludes the website, source photographs, research assets, runtime dependencies and lifecycle scripts. `.gitignore` excludes archives, generated builds, environment files and dependencies.

安装包约 24 KB，共 8 个文件，包含 API、引擎、类型声明、中英文 README、元数据和 MIT 许可；不包含网站、照片、研究资料、运行依赖或安装生命周期脚本。生成文件、环境文件和依赖目录已被忽略。

The mathematical profile adds three versioned 0–100 indices, with controlled tests for blank images, exact mirror symmetry, subpixel centring and tonal entropy. See [scoring](SCORING.md).

数学画像加入三个带版本的 0–100 指标，测试覆盖空白图、精确镜像、亚像素中轴与灰度熵。说明与卡片均支持中英文。
