type State = {
  ready: boolean;
  curves: { id: number; segments: number }[];
  selected: { id: number; segment: number } | null;
};
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
export function registerConstructionTools(
  read: () => State,
  select: (id: number, segment: number) => void,
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
      /* Progressive enhancement only. */
    }
  };
  register({
    name: 'get_construction_state',
    description:
      'Read the available visible boundary IDs, segment counts and selected cubic segment. No photograph is returned.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: () => read(),
  });
  register({
    name: 'select_curve_segment',
    description:
      'Select a visible curve segment and show its actual equation and control points in the editor.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        segment: { type: 'integer', minimum: 0 },
      },
      required: ['id', 'segment'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: (input) => {
      const state = read(),
        { id, segment } = (input ?? {}) as { id?: number; segment?: number };
      const c = state.curves.find((c) => c.id === id);
      if (!state.ready) throw Error('The construction is still computing.');
      if (
        !c ||
        !Number.isInteger(segment) ||
        segment! < 0 ||
        segment! >= c.segments
      )
        throw Error('Choose an existing visible curve and segment.');
      select(c.id, segment!);
      return read();
    },
  });
  return () => lifecycle.abort();
}
