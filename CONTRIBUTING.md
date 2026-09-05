# Contributing

This project is an experiment in making a few good drawing decisions. Improvements to recognisability, useful negative space, and expressive mark choice are especially welcome.

1. Run the project with Node 22 and `npm ci`.
2. Keep photo processing local. Do not add telemetry or inference APIs as a default.
3. For engine changes, run `npm test`, `npm run typecheck`, and `npm run build`. Add a meaningful test when changing numerical behavior.
4. Show before/after drawings at the same budget. Use images you may redistribute and include credit. Never commit private photos, credentials, or downloaded dependencies.
5. Explain tradeoffs: more faithful is not automatically more interesting.

The dependency-free engine is `public/engine.mjs`; its worker is `public/engine.worker.mjs`. The studio lives in `app/studio.tsx`. The numerical tests use Node's built-in test runner.

Optional browser WebMCP tools expose `get_drawing_state` and `seek_drawing` through feature detection. The initial release has numerical and compilation checks; the WebMCP integration has not been verified in a supporting browser context. Ordinary browsers do not require it.
