type State = {
  phase: string;
  shown: number;
  total: number;
  canStart: boolean;
  canStop: boolean;
};
type Tool = {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: () => unknown;
};
type Context = {
  registerTool: (
    tool: Tool,
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};
export function registerRevealTools(
  read: () => State,
  start: () => void,
  stop: () => void,
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
      /* Optional browser integration. */
    }
  };
  const schema = {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
  register({
    name: 'get_reveal_state',
    description:
      'Read the current round phase and how many boundaries are actually visible. Does not reveal the source photo.',
    inputSchema: schema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    execute: read,
  });
  register({
    name: 'start_reveal',
    description:
      'Start the prepared photo round or replay the same photo. The source stays hidden while reconstruction starts.',
    inputSchema: schema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute: () => {
      if (!read().canStart)
        throw Error('Wait for a prepared photo or finish this round first.');
      start();
      return read();
    },
  });
  register({
    name: 'stop_and_reveal',
    description:
      'Freeze the actually displayed frame and reveal the original photograph, ending the current round.',
    inputSchema: schema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: () => {
      if (!read().canStop)
        throw Error('No displayed frame is available to stop.');
      stop();
      return read();
    },
  });
  return () => lifecycle.abort();
}
