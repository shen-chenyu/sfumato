import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { createPortrait, redraw } from '../packages/sfumato/dist/index.mjs';

await test(
  'browser worker and installed API share pixels, recipes, language and errors',
  { timeout: 10000 },
  async () => {
    const path = new URL('../public/portrait.worker.mjs', import.meta.url).href;
    const worker = new Worker(
      `const {parentPort}=require('node:worker_threads'); globalThis.self={postMessage:(p,t)=>parentPort.postMessage(p,t)}; (async()=>{await import(${JSON.stringify(path)});parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage('ready');})();`,
      { eval: true },
    );
    try {
      await once(worker, 'message');
      const image = {
        width: 73,
        height: 91,
        data: Uint8ClampedArray.from({ length: 73 * 91 * 4 }, (_, i) =>
          i % 4 === 3 ? 255 : Math.floor(i / 4) % 73 < 32 ? 60 : 220,
        ),
      };
      const expected = createPortrait(image, { language: 'zh-CN' });
      worker.postMessage(
        { type: 'create', id: 7, image, options: { language: 'zh-CN' } },
        [image.data.buffer],
      );
      assert.equal(image.data.byteLength, 0);
      const [created] = await once(worker, 'message');
      assert.equal(created.id, 7);
      assert.equal(created.type, 'result');
      assert.deepEqual(created.result, expected);
      const recipe = JSON.parse(JSON.stringify(expected.recipe));
      recipe.construction.curves = [];
      recipe.language = 'en';
      worker.postMessage({ type: 'redraw', id: 8, recipe });
      const [edited] = await once(worker, 'message');
      assert.equal(edited.id, 8);
      assert.deepEqual(edited.result, redraw(recipe));
      for (const message of [
        { type: 'redraw', recipe: null },
        { type: 'unknown' },
      ]) {
        worker.postMessage({ ...message, id: 9 });
        const [error] = await once(worker, 'message');
        assert.equal(error.type, 'error');
        assert.equal(error.id, 9);
      }
    } finally {
      await worker.terminate();
    }
  },
);
