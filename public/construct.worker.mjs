import { construct, reconstruct } from './construct-engine.mjs';
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'construct') {
      const model = construct(data.pixels, data.settings);
      self.postMessage({ type: 'model', model, id: data.id });
    } else {
      const result = reconstruct(data.model, data.settings);
      self.postMessage({ type: 'render', ...result, id: data.id }, [
        result.pixels.buffer,
      ]);
    }
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message, id: data.id });
  }
};
