export function initialRound() {
  return {
    phase: 'loading',
    total: 0,
    requested: 0,
    displayed: 0,
    stopAt: null,
    finishReason: null,
    epoch: 0,
    frame: null,
  };
}
/** Accepted frames, rather than a timer, determine what the player actually saw. */
export function revealReducer(state, action) {
  switch (action.type) {
    case 'loading':
      return { ...initialRound(), epoch: state.epoch + 1 };
    case 'prepared':
      return {
        ...initialRound(),
        phase: action.total > 0 ? 'ready' : 'empty',
        total: action.total,
        epoch: state.epoch + 1,
      };
    case 'start':
      if (!['ready', 'result', 'trim'].includes(state.phase) || !state.total)
        return state;
      return {
        ...state,
        phase: 'playing',
        requested: 0,
        displayed: 0,
        stopAt: null,
        finishReason: null,
        frame: null,
        epoch: state.epoch + 1,
      };
    case 'frame':
      if (
        action.epoch !== state.epoch ||
        action.frame.count !== state.requested ||
        !['playing', 'result', 'trim'].includes(state.phase)
      )
        return state;
      return {
        ...state,
        displayed: action.frame.count,
        frame: action.frame,
        ...(state.phase === 'playing' && action.frame.count === state.total
          ? {
              phase: 'result',
              stopAt: action.frame.count,
              finishReason: 'complete',
            }
          : {}),
      };
    case 'advance':
      if (
        state.phase !== 'playing' ||
        !state.frame ||
        state.displayed !== state.requested
      )
        return state;
      return {
        ...state,
        requested: Math.min(state.total, state.requested + 1),
      };
    case 'stop':
      if (state.phase !== 'playing' || !state.frame) return state;
      return {
        ...state,
        phase: 'result',
        requested: state.displayed,
        stopAt: state.displayed,
        finishReason: 'player',
      };
    case 'trim':
      if (!['result', 'trim'].includes(state.phase)) return state;
      if (!Number.isInteger(action.count)) return state;
      return {
        ...state,
        phase: 'trim',
        requested: Math.max(0, Math.min(state.total, action.count)),
      };
    case 'return':
      if (state.stopAt === null || !['result', 'trim'].includes(state.phase))
        return state;
      return { ...state, phase: 'result', requested: state.stopAt };
    default:
      return state;
  }
}
