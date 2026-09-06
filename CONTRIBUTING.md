# Contributing

Photograph in, mathematical drawing and an explanation out. Keep the API approachable and its measurements reproducible. Prioritize attractive output, a simple API and reproducible recipes. Deeper surface research is optional and must not become a prerequisite for using the package. Do not add recognition quizzes, stroke-count challenges or hidden-photo reveals; interaction should help inspect and change the drawing.

The playful idea is a mathematical self-portrait: how many curves and stored values describe this photograph, with actual equations linked to the drawing. Keep those counts derived from the recipe and distinguish stored entries from independent parameters, file size, or claims about the person.

1. Run the project with Node 22 and `npm ci`.
2. Keep photo processing local. Do not add telemetry or inference APIs as a default.
3. For engine changes, run `npm test`, `npm run typecheck`, and `npm run build`. Add a meaningful test when changing numerical behavior.
4. Show before/after drawings at the same budget. Use images you may redistribute and include credit. Never commit private photos, credentials, or downloaded dependencies.
5. Explain tradeoffs: more faithful is not automatically more interesting.

The construction engine is `public/construct-engine.mjs`, its interface is `app/construction.tsx`, and its numerical checks are in `tests/construct.test.mjs`. See `docs/CONSTRUCTION.md` before changing its mathematical claims.

The standalone package API is `public/portrait.mjs`, with TypeScript declarations in `public/portrait.d.mts`. `npm run package:build` copies the shared API and engine into the package; do not edit the generated `dist` files. `npm test` builds the package before checking its public interface. `npm run package:pack` creates a local installable archive, without publishing. The core must stay free of framework and image-codec dependencies; file decoding/encoding belongs in adapters such as `examples/node`.

The earlier dependency-free stroke engine is `public/engine.mjs`; its worker is `public/engine.worker.mjs`. The studio lives in `app/studio.tsx`. The numerical tests use Node's built-in test runner.

The construction view optionally exposes `get_construction_state` and `select_curve_segment`. The earlier browser WebMCP tools expose `get_drawing_state` and `seek_drawing` through feature detection. The initial release has numerical and compilation checks; the WebMCP integration has not been verified in a supporting browser context. Ordinary browsers do not require it.

The bilingual homepage and `/construct/` both use the construction workspace and `public/portrait.worker.mjs`, which calls the same public API as the package. The worker message protocol is exercised in a Node worker wrapper; this does not substitute for browser interaction QA. The independent surface research prototype and its synthetic controls are documented in `research/surface/README.md`.
