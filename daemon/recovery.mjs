import agy from '../adapters/agy/index.mjs';
import claude from '../adapters/claude/index.mjs';
import codex from '../adapters/codex/index.mjs';
import { deliveryId } from '../inbox/message.mjs';
import { checkedTranscript } from './oar.mjs';
import { jsonRows, readText } from './io.mjs';

const adapters = { agy, claude, codex };

export function recoverCodexEnd(row, frame) {
  if (row?.cli !== 'codex' || !frame.turnId || !row.sessionId) return;
  const path = checkedTranscript(row.transcriptPath, row);
  if (!path) return;
  for (const { type, timestamp, payload } of jsonRows(readText(path))) {
    if (type !== 'event_msg' || payload?.turn_id !== frame.turnId ||
        !['turn_aborted', 'task_complete'].includes(payload.type)) continue;
    const at = Date.parse(timestamp);
    if (Number.isFinite(at)) return { at, canceled: payload.type === 'turn_aborted' };
  }
}

function userTurnId(provider, text, id) {
  let turn;
  for (const row of jsonRows(text)) {
    if (provider === 'agy') {
      if (['USER', 'USER_EXPLICIT'].includes(row.source) && ['REQUEST', 'USER_INPUT'].includes(row.type) &&
          deliveryId(row.content) === id) return String(row.step_index);
      continue;
    }
    const payload = row.payload ?? {};
    if (payload.type === 'task_started') turn = payload.turn_id;
    if (turn && (payload.type === 'user_message' && deliveryId(payload.message) === id ||
        payload.role === 'user' && payload.content?.some?.(part => deliveryId(part.text) === id))) return turn;
  }
}

function agyFinal(text, id, reply) {
  let matching = false;
  let final;
  for (const row of jsonRows(text)) {
    if (['USER', 'USER_EXPLICIT'].includes(row.source) && ['REQUEST', 'USER_INPUT'].includes(row.type)) {
      if (matching) break;
      matching = deliveryId(row.content) === id;
    } else if (matching && row.source === 'MODEL' && row.type === 'PLANNER_RESPONSE' && row.content?.trim()) {
      final = row;
    }
  }
  return final?.status === 'DONE' && final.content.trim() === reply?.trim();
}

export function recoverNativeDelivery(row, message) {
  const adapter = adapters[row?.cli];
  const path = adapter && checkedTranscript(row.transcriptPath, row);
  if (!path) return;
  const text = readText(path);
  const { turns } = adapter.transcript.parse(text);
  const nativeId = row.cli === 'claude' ? undefined : userTurnId(row.cli, text, message.id);
  const turn = row.cli === 'claude' ? turns.find(turn => turn.prompts.some(prompt => deliveryId(prompt) === message.id)) :
    nativeId && turns.find(turn => turn.id === nativeId);
  if (!turn) return;
  const at = Date.parse(turn.startedAt ?? '');
  const endedAt = Date.parse(turn.endedAt ?? '');
  const result = { at: Number.isFinite(at) ? at : message.attemptAt, sessionId: row.sessionId, turnId: turn.id };
  if (turn.status === 'incomplete' || !Number.isFinite(endedAt)) return result;
  const outcome = { kind: turn.status === 'interrupted' ? 'aborted' : 'completed' };
  const unconfirmed = row.cli === 'agy' && outcome.kind === 'completed' && !agyFinal(text, message.id, turn.reply);
  return { ...result, completion: { at: endedAt, sessionId: row.sessionId, turnId: turn.id, nativeTurnId: turn.id,
    nativeTurnIndex: turn.index, outcome, source: 'native transcript',
    ...(unconfirmed ? { noReply: true, unconfirmed: true, unconfirmedBody: turn.reply } :
      outcome.kind === 'completed' && turn.reply ? { body: turn.reply } : { noReply: true }),
  } };
}
