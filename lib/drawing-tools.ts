type State = { count: number; total: number; busy: boolean };
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown;
};
type Context = {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
/** Progressive enhancement: browsers without WebMCP use exactly the same UI. */
export function registerDrawingTools(
  read: () => State,
  seek: (n: number) => void,
) {
  const context = (document as Document & { modelContext?: Context })
    .modelContext;
  if (!context?.registerTool) return;
  const lifecycle = new AbortController();
  const register = (tool: Tool) => {
    try {
      Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Optional browser capability. */
    }
  };
  register({
    name: 'get_drawing_state',
    description:
      'Read the visible stroke count, drawing length and whether computation is running.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: () => ({ ...read() }),
  });
  register({
    name: 'seek_drawing',
    description:
      'Pause playback and show exactly this many computed strokes in the drawing view.',
    inputSchema: {
      type: 'object',
      properties: { count: { type: 'integer', minimum: 0 } },
      required: ['count'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: (input) => {
      const state = read(),
        value = (input as { count?: unknown })?.count;
      if (state.busy) throw Error('Wait for the drawing to finish computing.');
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > state.total
      )
        throw Error(`Count must be between 0 and ${state.total}.`);
      seek(value);
      return { ...read() };
    },
  });
  return () => lifecycle.abort();
}
