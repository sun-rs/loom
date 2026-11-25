const fields = {
  input: 'inputTokens',
  cacheRead: 'cachedInputTokens',
  cacheWrite: 'cacheWriteInputTokens',
  output: 'outputTokens',
  reasoning: 'reasoningOutputTokens',
};

const activity = new Set(['text_delta', 'reasoning', 'tool_call_started', 'turn_ended']);
const stuckReasons = { quota: 'rate-limit', rate_limited: 'rate-limit', auth: 'auth' };

export function protocolEvents({ addr, sessionId, cli, write, nativeReply, exited }) {
  let turn = 0;
  let active = false;
  let text = '';
  let messageId;
  let stuck;
  const totals = {};

  return event => {
    if (event.sessionId !== sessionId || event.agentPath.length) return;
    const emit = (type, data = {}) => write({
      eventId: `${addr}:${event.seq}:${type}`, addr, at: event.receivedAt, type, ...data,
    });
    if (event.kind === 'exited') return exited(event.receivedAt);
    // agy ACP has no separate turn-start notification.
    if (!active && (event.kind === 'turn_active' || cli === 'agy' &&
      (activity.has(event.kind) || event.kind === 'usage' && (event.usage.tokens || event.usage.total)))) {
      active = true;
      text = '';
      messageId = undefined;
      emit('turn-start', { turn: ++turn });
    }
    if (event.kind === 'usage') {
      const usage = {};
      const tokens = event.usage.total ?? event.usage.tokens ?? {};
      for (const [source, target] of Object.entries(fields)) {
        if (!Number.isSafeInteger(tokens[source]) || tokens[source] <= (totals[source] ?? 0)) continue;
        usage[target] = tokens[source] - (totals[source] ?? 0);
        totals[source] = tokens[source];
      }
      if (active && Object.keys(usage).length) emit('usage', { turn, usage });
    }
    if (!active) return;
    if (event.kind === 'tool_call_started' && cli === 'agy') text = '';
    if (event.kind === 'text_delta' && (cli === 'agy' || event.phase === 'final_answer')) {
      if (event.messageId !== messageId) text = '';
      messageId = event.messageId;
      text += event.text;
    }
    if (event.kind === 'turn_ended') {
      const reason = stuckReasons[event.outcome.failure];
      if (reason && reason !== stuck) emit('stuck', { reason });
      stuck = reason;
      const finalReply = event.outcome.kind === 'completed' ? nativeReply(turn) ?? (text.trim() ? text : null) : null;
      emit('turn-end', { turn, finalReply });
      active = false;
    }
  };
}
