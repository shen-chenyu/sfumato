import { construct, reconstruct, rankForReveal } from './construct-engine.mjs';
self.onmessage = ({ data }) => {
  try {
    if (data.type === 'construct') {
      const initial = construct(data.pixels, data.settings);
      const model = data.settings?.reveal ? rankForReveal(initial) : initial;
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
