const positive = (...values) => values.find(value => Number.isFinite(value) && value > 0) ?? null;
const count = (...values) => values.find(value => Number.isFinite(value) && value >= 0) ?? null;
const at = row => {
  const time = row?.timestamp ?? row?.created_at ?? row?.receivedAt ?? row?.at;
  return typeof time === 'number' ? time : Date.parse(time ?? '');
};

// Antigravity's product limit is distinct from the underlying Gemini API.
const modelWindows = {
  agy: { 'gemini-4-neon': 512_000 },
  claude: {
    'claude-sonnet-5-5': 1_000_000, 'claude-opus-5-5': 1_000_000, 'claude-haiku-5-5': 1_000_000,
    'claude-sonnet-5': 1_000_000, 'claude-sonnet-4-6': 1_000_000, 'claude-opus-4-6': 1_000_000,
    'claude-sonnet-4-5': 200_000, 'claude-haiku-4-5': 200_000,
  },
  codex: { 'gpt-6.2-sol': 475_000 },
};

export const rootEvents = (session, events) => events.filter(row => !row.agent_id && !row.isSidechain &&
  (!session.sessionId || (row.session_id ?? row.sessionId ?? row.conversationId) === session.sessionId));

const rootRow = row => !row.agent_id && !row.isSidechain && !row.parent_tool_use_id && !row.parentToolUseId;

export function sessionContext(session, { raw = [], items = [] } = {}, { events = [], statusline, snapshot = {} } = {}) {
  const nativeRows = raw.filter(rootRow);
  const nativeCompactions = nativeRows.filter(row => row.type === 'compacted' || row.type === 'compact_boundary' ||
    row.type === 'system' && row.subtype === 'compact_boundary' || row.payload?.type === 'context_compacted');
  const journalCompactions = events.filter(row => row.hook_event_name === 'PostCompact' ||
    row.type === 'compaction_ended' && (row.outcome === undefined || row.outcome?.kind === 'completed'));
  const nativeTimes = nativeCompactions.map(at);
  const matched = new Set();
  const compactTimes = [...nativeTimes, ...journalCompactions.map(at).filter(time => {
    const same = nativeTimes.findIndex((prior, i) => !matched.has(i) && Math.abs(time - prior) <= 5_000);
    if (same === -1) return true;
    matched.add(same);
    return false;
  })].sort((a, b) => (a || 0) - (b || 0));
  const compactions = raw.length || events.length ? compactTimes.length : null;
  const compactedAt = compactTimes.findLast(Number.isFinite) ?? -Infinity;

  const reading = (value, source, time) => {
    const data = value?.value ?? value;
    return { source, at: Number.isFinite(time) ? time : -Infinity, contextWindow: positive(data?.contextWindow, data?.window),
      tokens: count(data?.tokens, data?.contextTokens), inputTokens: count(data?.inputTokens), percent: count(data?.percent) };
  };
  const readings = [];
  const structured = [...nativeRows, ...events];
  const location = structured.findLast(row => typeof (row.cwd ?? row.payload?.cwd) === 'string' &&
    (['SessionStart', 'UserPromptSubmit'].includes(row.hook_event_name) || row.type === 'session_meta'));
  const version = structured.findLast(row => typeof (row.cliVersion ?? row.version ?? row.payload?.cli_version) === 'string' &&
    (row.type === 'session_meta' || row.type === 'system' && row.subtype === 'init' || row.hook_event_name === 'SessionStart'));
  const codex = session.cli === 'codex';
  for (const row of nativeRows) {
    const payload = row.payload;
    if (codex && (payload?.type === 'token_count' || payload?.type === 'task_started')) {
      const usage = payload.info?.last_token_usage;
      readings.push(reading({ contextWindow: payload.info?.model_context_window ?? payload.model_context_window,
        tokens: usage?.total_tokens, inputTokens: usage?.input_tokens }, 'codex-rollout', at(row)));
    } else if (row.contextUsage || row.usage?.context || row.modelInfo?.contextWindow) {
      readings.push(reading(row.contextUsage ?? row.usage?.context ?? row.modelInfo, 'native-metadata', at(row)));
    }
  }
  const nativeModel = nativeRows.findLast(row => typeof (row.message?.model ?? row.model_name ?? row.model ?? row.payload?.model) === 'string' &&
    (row.message?.model ?? row.model_name ?? row.model ?? row.payload?.model) !== '<synthetic>');
  const model = nativeModel?.message?.model ?? nativeModel?.model_name ?? nativeModel?.model ?? nativeModel?.payload?.model ?? session.model;
  const claudeResult = session.cli === 'claude' && nativeRows.findLast(row => row.modelUsage?.[model]?.contextWindow);
  if (claudeResult) readings.push(reading(claudeResult.modelUsage[model], 'claude-result', at(claudeResult)));
  for (const row of events) {
    const context = row.contextUsage ?? row.context ?? row.usage?.context;
    if (context || Number.isFinite(row.usage?.inputTokens)) {
      readings.push(reading({ ...(context?.value ?? context), inputTokens: row.usage?.inputTokens ?? context?.inputTokens },
        session.cli === 'agy' ? 'agy-acp' : 'native-journal', at(row)));
    }
  }
  const live = snapshot.signals?.context ?? snapshot.contextUsage ?? snapshot.runtimeStatus?.contextUsage;
  if (live) readings.push(reading(live, 'native-runtime', at(live)));
  if (session.cli === 'claude' && statusline?.sessionId === session.sessionId) {
    readings.push(reading(statusline, 'claude-statusline', at(statusline)));
  }
  for (const { turn } of items) for (const call of turn.calls ?? []) {
    const time = at(call);
    const callAt = Number.isFinite(time) ? time : at({ timestamp: turn.endedAt ?? turn.startedAt });
    readings.push(reading({ inputTokens: call.inputTokens }, 'native-call', callAt));
  }
  readings.sort((a, b) => a.at - b.at);
  const measuredWindow = readings.findLast(item => item.contextWindow !== null);
  const baseModel = typeof model === 'string' ? model.toLowerCase().replace(/\[1m\]$|-\d{8}$|-(?:xhigh|high|medium|low)$/g, '') : '';
  const fallback = modelWindows[session.cli]?.[baseModel] ?? null;
  const contextWindow = measuredWindow?.contextWindow ?? fallback;
  const windowSource = measuredWindow?.source ?? (fallback ? 'model-table' : null);
  const latestInput = readings.findLast(item => item.inputTokens !== null && item.at >= compactedAt);
  const occupancy = readings.findLast(item => (item.tokens !== null || item.percent !== null) && item.at >= compactedAt);
  const inputTokens = latestInput?.inputTokens ?? null;
  const tokens = occupancy?.tokens ?? (occupancy?.percent != null ? null : inputTokens);
  const percent = tokens !== null && contextWindow ? 100 * tokens / contextWindow : occupancy?.percent ?? null;
  const afterCompaction = compactTimes.map((time, i) => {
    const sample = Number.isFinite(time) && readings.find(item => item.at > time &&
      item.at < (compactTimes[i + 1] ?? Infinity) && (item.tokens ?? item.percent ?? item.inputTokens) !== null);
    const window = sample && readings.findLast(item => item.at <= sample.at && item.contextWindow !== null);
    const size = window?.contextWindow ?? fallback;
    const used = sample && (sample.tokens ?? (sample.percent === null ? sample.inputTokens : null));
    return { at: Number.isFinite(time) ? time : null, sampledAt: sample?.at ?? null,
      percent: Number.isFinite(used) && size ? 100 * used / size : sample?.percent ?? null,
      contextWindow: sample ? size : null, windowSource: sample ? window?.source ?? (fallback ? 'model-table' : null) : null };
  });
  const nativeVersion = version?.cliVersion ?? version?.version ?? version?.payload?.cli_version;
  return { tokens, inputTokens, contextWindow, percent, windowSource, compactions, afterCompaction,
    ...(location && { cwd: location.cwd ?? location.payload.cwd }), ...(nativeVersion && { nativeVersion }) };
}
