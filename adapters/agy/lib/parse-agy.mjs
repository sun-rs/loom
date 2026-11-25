// Source: /Users/sun/Code/exp-relay/orca/lib/agy.mjs (loom-transcript v1).
const USER_SOURCES = new Set(['USER_EXPLICIT', 'USER']);
const USER_TYPES = new Set(['USER_INPUT', 'REQUEST']);
const INTERRUPTED_STATUSES = new Set([
  'CANCELED',
  'CANCELLED',
  'ABORTED',
  'INTERRUPTED',
]);

function createEmptyUsage() {
  return {
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function addCallToUsage(usage, call) {
  usage.calls += 1;
  usage.inputTokens += call.inputTokens;
  usage.cachedInputTokens += call.cachedInputTokens;
  usage.cacheWriteInputTokens += call.cacheWriteInputTokens;
  usage.outputTokens += call.outputTokens;
  usage.reasoningOutputTokens += call.reasoningOutputTokens;
}

function addUsage(target, source) {
  target.calls += source.calls;
  target.inputTokens += source.inputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.cacheWriteInputTokens += source.cacheWriteInputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStepId(stepIndex) {
  if (typeof stepIndex === 'number') {
    if (Number.isSafeInteger(stepIndex) && stepIndex >= 0) {
      return String(stepIndex === 0 ? 0 : stepIndex);
    }
    return null;
  }
  if (typeof stepIndex === 'string') {
    const trimmed = stepIndex.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function normalizeTimestamp(value) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return null;
}

function normalizeStatus(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toUpperCase();
}

function isValidTokenCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function pickTokenCount(record, usageObj, key) {
  if (isValidTokenCount(record[key])) {
    return record[key] === 0 ? 0 : record[key];
  }
  if (usageObj !== null && isValidTokenCount(usageObj[key])) {
    return usageObj[key] === 0 ? 0 : usageObj[key];
  }
  return null;
}

function extractCall(record) {
  const usageObj = isPlainObject(record.usage) ? record.usage : null;

  const rawInput = pickTokenCount(record, usageObj, 'input_tokens');
  const cacheRead = pickTokenCount(record, usageObj, 'cache_read_tokens');
  const cacheWrite = pickTokenCount(record, usageObj, 'cache_write_tokens');
  const output = pickTokenCount(record, usageObj, 'output_tokens');
  const reasoning = pickTokenCount(record, usageObj, 'reasoning_output_tokens');

  if (
    rawInput === null &&
    cacheRead === null &&
    cacheWrite === null &&
    output === null &&
    reasoning === null
  ) {
    return null;
  }

  const inputBase = rawInput ?? 0;
  const cachedInputTokens = cacheRead ?? 0;
  const cacheWriteInputTokens = cacheWrite ?? 0;
  const outputTokens = output ?? 0;
  const reasoningOutputTokens = reasoning ?? 0;

  return {
    id: normalizeStepId(record.step_index),
    timestamp: normalizeTimestamp(record.created_at),
    inputTokens: inputBase + cachedInputTokens + cacheWriteInputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningOutputTokens,
  };
}

function isUserStart(record) {
  return USER_SOURCES.has(record.source) && USER_TYPES.has(record.type);
}

function isPlannerResponse(record) {
  return record.source === 'MODEL' && record.type === 'PLANNER_RESPONSE';
}

function hasToolCalls(record) {
  return (
    (Array.isArray(record.tool_calls) && record.tool_calls.length > 0) ||
    (Array.isArray(record.toolCalls) && record.toolCalls.length > 0)
  );
}

function hasNonEmptyContent(record) {
  return typeof record.content === 'string' && record.content.trim().length > 0;
}

function parseJsonlRecords(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return [];
  }

  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = normalized.split(/\r?\n/);

  const records = [];
  const stepPositions = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (rawLine.trim().length === 0) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      continue;
    }

    if (!isPlainObject(parsed)) {
      continue;
    }

    if (typeof parsed.source !== 'string' || typeof parsed.type !== 'string') {
      continue;
    }

    const stepId = normalizeStepId(parsed.step_index);
    if (stepId !== null) {
      const existingIndex = stepPositions.get(stepId);
      if (existingIndex !== undefined) {
        records[existingIndex] = parsed;
      } else {
        stepPositions.set(stepId, records.length);
        records.push(parsed);
      }
    } else {
      records.push(parsed);
    }
  }

  return records;
}

export const agyTurnPrompt = new WeakMap();

function createTurnState(record) {
  return {
    id: normalizeStepId(record.step_index),
    startedAt: normalizeTimestamp(record.created_at),
    lastActivityAt: normalizeTimestamp(record.created_at),
    prompt: typeof record.content === 'string' ? record.content : null,
    hasModelStep: false,
    explicitInterrupted: false,
    interruptedAt: null,
    completed: false,
    completedAt: null,
    candidateReply: null,
    usage: createEmptyUsage(),
    calls: [],
  };
}

function clearCandidate(turnState) {
  turnState.completed = false;
  turnState.completedAt = null;
  turnState.candidateReply = null;
}

function settleTurn(turnState, index, reason) {
  let status;
  let endedAt;
  let reply;

  if (turnState.explicitInterrupted) {
    status = 'interrupted';
    endedAt = turnState.interruptedAt ?? turnState.lastActivityAt;
    reply = null;
  } else if (turnState.completed) {
    status = 'completed';
    endedAt = turnState.completedAt;
    reply = turnState.candidateReply;
  } else if (reason === 'next_user' && turnState.hasModelStep) {
    status = 'interrupted';
    endedAt = turnState.lastActivityAt;
    reply = null;
  } else {
    status = 'incomplete';
    endedAt = null;
    reply = null;
  }

  const turn = {
    index,
    id: turnState.id,
    startedAt: turnState.startedAt,
    endedAt,
    status,
    reply,
    usage: turnState.usage,
    calls: turnState.calls,
  };
  if (turnState.prompt) agyTurnPrompt.set(turn, turnState.prompt);
  return turn;
}

/**
 * Parse an Antigravity CLI (agy) JSONL transcript into a v1 Session object.
 * @param {string} text
 * @param {(index: number, record: object) => void} [onTurnRecord]
 */
export function parseAgy(text, onTurnRecord) {
  const records = parseJsonlRecords(text);
  const turns = [];
  const sessionUsage = createEmptyUsage();
  let lastReply = null;
  let activeTurn = null;

  const finalizeActiveTurn = (reason) => {
    if (activeTurn === null) {
      return;
    }
    const turn = settleTurn(activeTurn, turns.length + 1, reason);
    turns.push(turn);
    addUsage(sessionUsage, turn.usage);
    if (turn.status === 'completed' && turn.reply !== null) {
      lastReply = turn.reply;
    }
    activeTurn = null;
  };

  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];

    if (isUserStart(record)) {
      finalizeActiveTurn('next_user');
      activeTurn = createTurnState(record);
      onTurnRecord?.(turns.length, record);
      const status = normalizeStatus(record.status);
      if (INTERRUPTED_STATUSES.has(status)) {
        activeTurn.explicitInterrupted = true;
        activeTurn.interruptedAt = normalizeTimestamp(record.created_at);
      }
      continue;
    }

    if (activeTurn === null) {
      continue;
    }
    activeTurn.lastActivityAt = normalizeTimestamp(record.created_at) ?? activeTurn.lastActivityAt;
    onTurnRecord?.(turns.length, record);

    if (record.source === 'MODEL') {
      activeTurn.hasModelStep = true;
    }

    if (isPlannerResponse(record)) {
      const call = extractCall(record);
      if (call !== null) {
        activeTurn.calls.push(call);
        addCallToUsage(activeTurn.usage, call);
      }
    }

    const status = normalizeStatus(record.status);
    if (INTERRUPTED_STATUSES.has(status)) {
      const ts = normalizeTimestamp(record.created_at);
      if (!activeTurn.explicitInterrupted) {
        activeTurn.explicitInterrupted = true;
        activeTurn.interruptedAt = ts;
      } else if (ts !== null) {
        activeTurn.interruptedAt = ts;
      }
      clearCandidate(activeTurn);
      continue;
    }

    if (activeTurn.explicitInterrupted) {
      continue;
    }

    if (hasToolCalls(record)) {
      clearCandidate(activeTurn);
      continue;
    }

    if (isPlannerResponse(record)) {
      if (status === '' || status === 'DONE') {
        if (hasNonEmptyContent(record)) {
          activeTurn.completed = true;
          activeTurn.completedAt = normalizeTimestamp(record.created_at);
          activeTurn.candidateReply = record.content;
        }
      } else {
        clearCandidate(activeTurn);
      }
    }
  }

  finalizeActiveTurn('eof');

  return {
    provider: 'agy',
    turns,
    lastReply,
    usage: sessionUsage,
  };
}
