import { generate } from './engine.mjs';
self.onmessage = ({ data }) => {
  try {
    const result = generate(data.pixels, data.settings, (phase, value) =>
      self.postMessage({ type: 'progress', phase, value }),
    );
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Drawing failed.',
    });
  }
};
