// Source: /Users/sun/Code/exp-relay/orca/lib/codex.mjs, loom-transcript Codex parser.
import { noteEventTool, noteResponseTool, turnActivity } from './activity.mjs';

const tokenFields = [
  ['input_tokens', 'inputTokens'],
  ['cached_input_tokens', 'cachedInputTokens'],
  ['cache_write_input_tokens', 'cacheWriteInputTokens'],
  ['output_tokens', 'outputTokens'],
  ['reasoning_output_tokens', 'reasoningOutputTokens'],
];

const userTextTypes = new Set(['input_text', 'text']);
const assistantTextTypes = new Set(['output_text', 'text']);
const toolStartEvents = new Set([
  'tool_call', 'exec_command_begin', 'mcp_tool_call_begin', 'web_search_begin', 'apply_patch_begin',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value) {
  return typeof value === 'string' ? value : null;
}

function replyText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function messageText(content, types) {
  if (!Array.isArray(content)) return null;

  const blocks = content.filter(block => types.has(block?.type) && typeof block.text === 'string');
  return blocks.length ? blocks.map(block => block.text).join('') : null;
}

function isTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function readTokenCounts(value) {
  if (!isObject(value)) return null;

  const counts = {};
  let valid = false;
  for (const [source, field] of tokenFields) {
    const count = value[source];
    const validCount = isTokenCount(count);
    counts[field] = validCount && count > 0 ? count : 0;
    valid ||= validCount;
  }
  return valid ? counts : null;
}

function readSnapshot(value) {
  if (!isObject(value)) return null;

  const counts = readTokenCounts(value);
  const total = isTokenCount(value.total_tokens) ? value.total_tokens : null;
  return counts || total !== null ? { counts, total } : null;
}

function sameSnapshot(current, previous) {
  return current.total === previous.total && tokenFields.every(([, field]) =>
    (current.counts?.[field] ?? 0) === (previous.counts?.[field] ?? 0));
}

function snapshotDelta(current, previous) {
  const counts = {};
  for (const [, field] of tokenFields) {
    const prior = previous?.[field] ?? 0;
    counts[field] = current[field] >= prior ? current[field] - prior : current[field];
  }
  return counts;
}

function emptyUsage() {
  return {
    calls: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function addTokens(target, counts) {
  for (const [, field] of tokenFields) target[field] += counts[field];
}

export function parseCodex(text) {
  const turns = [];
  const explicitTurns = new Map();
  const callsById = new Map();
  let active = null;
  let previousSnapshot = null;

  function endTurn({ boundary = false, exit = null, timestamp = null, reply = null } = {}) {
    if (!active) return;

    const candidate = active.finalAnswer ?? (boundary || exit === 'completed' ? active.legacyAnswer : null);
    active.status = exit ?? (candidate ? 'completed' : 'incomplete');
    active.endedAt = exit ? timestamp : candidate?.timestamp ?? null;
    active.reply = active.status === 'completed' ? reply ?? candidate?.text ?? null : null;
    active = null;
  }

  function beginTurn(id, timestamp, explicit) {
    endTurn({ boundary: true });
    active = {
      id,
      startedAt: timestamp,
      explicit,
      awaitingUser: explicit,
      pendingUser: null,
      finalAnswer: null,
      legacyAnswer: null,
      modernCalls: [],
      legacyCalls: [],
      activity: { prompts: [], tools: new Map() },
    };
    turns.push(active);
    if (explicit && id !== null) explicitTurns.set(id, active);
  }

  function receiveUser(kind, id, text, timestamp) {
    if (/^\s*<(?:environment_context|user_instructions)>/.test(text ?? '')) return;

    const pending = active?.pendingUser;
    if (pending && pending.kind !== kind && pending.text === text) {
      if (!active.explicit && id !== null && (kind === 'response_item' || active.id === null)) {
        active.id = id;
      }
      active.pendingUser = null;
      return;
    }

    // Native steering can submit another user message inside the explicit turn.
    if (!active?.awaitingUser && !active?.explicit) beginTurn(id, timestamp, false);
    active.finalAnswer = null;
    active.legacyAnswer = null;
    active.awaitingUser = false;
    active.pendingUser = { kind, text };
    if (text.trim()) active.activity.prompts.push(text);
  }

  function receiveAssistant(text, timestamp, final = false) {
    active.awaitingUser = false;
    active.pendingUser = null;
    if (final) active.finalAnswer = { text: replyText(text), timestamp };
    else if (text !== null) active.legacyAnswer = replyText(text) === null ? null : { text, timestamp };
  }

  function receiveToolCall() {
    active.awaitingUser = false;
    active.pendingUser = null;
    active.legacyAnswer = null;
  }

  function receiveModernUsage(payload, timestamp) {
    const counts = readTokenCounts(payload.usage);
    if (!counts) return;

    const id = stringOrNull(payload.response_id);
    const call = { id, timestamp, ...counts };
    const previousCall = callsById.get(id);
    if (previousCall) {
      Object.assign(previousCall, call);
      return;
    }

    const turn = explicitTurns.get(payload.turn_id) ?? active;
    if (!turn) return;

    turn.modernCalls.push(call);
    if (id !== null) callsById.set(id, call);
  }

  function receiveLegacyUsage(info, timestamp) {
    if (!isObject(info)) return;

    const snapshot = readSnapshot(info.total_token_usage);
    const prior = previousSnapshot;
    if (snapshot) {
      previousSnapshot = snapshot;
      if (prior && sameSnapshot(snapshot, prior)) return;
    }
    if (!active) return;

    const counts = readTokenCounts(info.last_token_usage)
      ?? (snapshot?.counts && snapshotDelta(snapshot.counts, prior?.counts));
    if (counts) active.legacyCalls.push({ id: null, timestamp, ...counts });
  }

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record;
    try {
      record = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isObject(record) || !isObject(record.payload)) continue;

    const { payload } = record;
    const timestamp = stringOrNull(record.timestamp);
    if (record.type === 'event_msg') {
      const id = stringOrNull(payload.turn_id);
      switch (payload.type) {
        case 'task_started':
        case 'turn_started':
          beginTurn(id, timestamp, true);
          break;
        case 'task_complete':
        case 'turn_complete':
        case 'turn_aborted':
          if (active?.explicit && active.id !== null && id !== null && active.id !== id) break;
          endTurn({
            exit: payload.type === 'turn_aborted' ? 'interrupted' : 'completed',
            timestamp,
            reply: replyText(payload.last_agent_message),
          });
          break;
        case 'user_message':
          receiveUser('event_msg', stringOrNull(payload.id), stringOrNull(payload.message) ?? '', timestamp);
          break;
        case 'agent_message':
          if (active && (payload.phase == null || payload.phase === 'final_answer')) {
            receiveAssistant(stringOrNull(payload.message), timestamp);
          }
          break;
        case 'token_count':
          receiveLegacyUsage(payload.info, timestamp);
          break;
        default:
          if (active && (id === null || active.id === null || id === active.id)) {
            noteEventTool(active.activity.tools, payload);
            if (toolStartEvents.has(payload.type)) receiveToolCall();
          }
      }
    } else if (record.type === 'response_item') {
      if (payload.type === 'message' && payload.role === 'user') {
        receiveUser('response_item', stringOrNull(payload.id), messageText(payload.content, userTextTypes) ?? '', timestamp);
      } else if (active && payload.type === 'message' && payload.role === 'assistant') {
        if (payload.phase == null || payload.phase === 'final_answer') {
          receiveAssistant(messageText(payload.content, assistantTextTypes), timestamp, payload.phase === 'final_answer');
        }
      } else if (active && typeof payload.type === 'string') {
        noteResponseTool(active.activity.tools, payload);
        if (payload.type.endsWith('_call')) receiveToolCall();
      }
    } else if (record.type === 'token_usage_record') {
      receiveModernUsage(payload, timestamp);
    }
  }
  endTurn();

  let lastReply = null;
  const usage = emptyUsage();
  const results = turns.map((turn, offset) => {
    const calls = turn.modernCalls.length ? turn.modernCalls : turn.legacyCalls;
    const turnUsage = emptyUsage();
    turnUsage.calls = calls.length;
    for (const call of calls) {
      addTokens(turnUsage, call);
      addTokens(usage, call);
    }
    usage.calls += calls.length;
    if (turn.reply !== null) lastReply = turn.reply;
    const result = {
      index: offset + 1,
      id: turn.id,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      status: turn.status,
      reply: turn.reply,
      usage: turnUsage,
      calls,
    };
    turnActivity.set(result, turn.activity);
    return result;
  });
  return { provider: 'codex', turns: results, lastReply, usage };
}
