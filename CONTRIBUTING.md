# Contributing

This project is an experiment in making a few good drawing decisions. Improvements to recognisability, useful negative space, and expressive mark choice are especially welcome.

1. Run the project with Node 22 and `npm ci`.
2. Keep photo processing local. Do not add telemetry or inference APIs as a default.
3. For engine changes, run `npm test`, `npm run typecheck`, and `npm run build`. Add a meaningful test when changing numerical behavior.
4. Show before/after drawings at the same budget. Use images you may redistribute and include credit. Never commit private photos, credentials, or downloaded dependencies.
5. Explain tradeoffs: more faithful is not automatically more interesting.

The construction engine is `public/construct-engine.mjs`, its interface is `app/construction.tsx`, and its numerical checks are in `tests/construct.test.mjs`. See `docs/CONSTRUCTION.md` before changing its mathematical claims.

The earlier dependency-free stroke engine is `public/engine.mjs`; its worker is `public/engine.worker.mjs`. The studio lives in `app/studio.tsx`. The numerical tests use Node's built-in test runner.

The construction view optionally exposes `get_construction_state` and `select_curve_segment`. The earlier browser WebMCP tools expose `get_drawing_state` and `seek_drawing` through feature detection. The initial release has numerical and compilation checks; the WebMCP integration has not been verified in a supporting browser context. Ordinary browsers do not require it.

The reveal game is `app/reveal.tsx`. Its pure state transitions are in `public/reveal-state.mjs`, with tests for pending-frame races, replay isolation, automatic exhaustion, trimming, and empty inputs. The actual worker message protocol is also exercised in a Node worker wrapper; this does not substitute for browser interaction QA. Optional root WebMCP tools are `get_reveal_state`, `start_reveal`, and `stop_and_reveal`; their supporting-browser integration remains unverified.
