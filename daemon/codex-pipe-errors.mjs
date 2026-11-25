const distribution = import.meta.resolve('@botiverse/oar');
// Reuse the classifiers from the OAR version pinned in package-lock.json.
export const { codexFailure } = await import(new URL('runtimes/codex/failure.js', distribution));
const { codexControlRefusal } = await import(new URL('runtimes/codex/refusal.js', distribution));

export function codexRefusal(method, error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  const data = error?.data;
  const info = data?.codexErrorInfo ?? data?.codex_error_info ?? data;
  const { code, failure } = codexControlRefusal(message, error);
  if (failure === 'overloaded' || info === 'serverOverloaded' || message === 'serverOverloaded') return 'provider-overloaded';
  if (error?.code === -32600) {
    if (method === 'thread/resume' && /^thread \S+ already has an active writer$/u.test(message)) return 'in_use';
    const notSteerable = message === 'activeTurnNotSteerable' || info === 'activeTurnNotSteerable' ||
      Boolean(info && typeof info === 'object' && Object.hasOwn(info, 'activeTurnNotSteerable'));
    if (method === 'turn/steer' && (notSteerable ||
        ['no active turn to steer', 'active turn uses a different output schema'].includes(message))) return 'steer-unavailable';
    if (method === 'turn/interrupt' && message === 'no active turn to interrupt') return 'status_mismatch';
    if (method === 'turn/start' && (notSteerable || message === 'active turn uses a different output schema')) return 'input-refused';
  }
  if (code === 'session_not_found' || ['input_too_large', 'invalid_request'].includes(failure)) return 'input-refused';
}
