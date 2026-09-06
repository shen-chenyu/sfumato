import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
await test(
  'the actual worker constructs curves, transfers a frame and reports malformed recipes',
  { timeout: 10000 },
  async () => {
    const path = new URL('../public/construct.worker.mjs', import.meta.url)
      .href;
    const worker = new Worker(
      `const{parentPort}=require('node:worker_threads');globalThis.self={postMessage:(p,t)=>parentPort.postMessage(p,t)};(async()=>{await import(${JSON.stringify(path)});parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({type:'ready'});})();`,
      { eval: true },
    );
    try {
      await once(worker, 'message');
      const pixels = Uint8ClampedArray.from(
        { length: 160 * 160 * 4 },
        (_, i) =>
          i % 4 === 3
            ? 255
            : Math.hypot(
                  (Math.floor(i / 4) % 160) - 80,
                  Math.floor(i / 640) - 80,
                ) < 50
              ? 70
              : 240,
      );
      worker.postMessage({
        type: 'construct',
        pixels,
        settings: {},
      });
      const [modelMessage] = await once(worker, 'message');
      assert.equal(modelMessage.type, 'model');
      assert.ok(modelMessage.model.curves.length > 0);
      const budget = Math.min(5, modelMessage.model.curves.length);
      worker.postMessage({
        type: 'render',
        model: modelMessage.model,
        settings: { budget },
        id: 12,
      });
      const [render] = await once(worker, 'message');
      assert.equal(render.type, 'render');
      assert.equal(render.id, 12);
      assert.equal(render.stats.curves, budget);
      assert.equal(render.pixels.length, 160 * 160 * 4);
      assert.ok(render.pixels instanceof Uint8ClampedArray);
      worker.postMessage({ type: 'render', model: {}, id: 13 });
      const [error] = await once(worker, 'message');
      assert.equal(error.type, 'error');
      assert.equal(error.id, 13);
    } finally {
      await worker.terminate();
    }
  },
);
