import { createPortrait, redraw } from './portrait.mjs';
self.onmessage = ({ data }) => {
  try {
    let result;
    if (data.type === 'create')
      result = createPortrait(data.image, data.options);
    else if (data.type === 'redraw') result = redraw(data.recipe);
    else throw new Error('Unknown portrait operation.');
    self.postMessage({ type: 'result', id: data.id, result }, [
      result.image.data.buffer,
    ]);
  } catch (error) {
    self.postMessage({
      type: 'error',
      id: data.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
