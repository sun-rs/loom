import { appendFileSync, constants, lstatSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { antigravityRuntime, claudeRuntime, codexRuntime, createRuntimeRegistry, opencodeRuntime } from '@botiverse/oar';
import agy from '../adapters/agy/index.mjs';
import claude from '../adapters/claude/index.mjs';
import codex from '../adapters/codex/index.mjs';
import { deliveryId, wireText } from '../inbox/message.mjs';
import { eventPath, jsonRows, prepareJournal } from './io.mjs';
import { codexFastArgs, nativeClaude } from './executables.mjs';
import { finishHead, headAt } from './turn-heads.mjs';
import { codexEnvironmentArgs } from '../cli/project.mjs';

const registry = createRuntimeRegistry([codexRuntime, antigravityRuntime, opencodeRuntime, claudeRuntime]);
const adapters = { codex, agy, claude };
const rateFailure = new Set(['rate_limited', 'quota']);
const acpProviders = new Set(['agy', 'opencode']);
const activeEvents = new Set(['turn_active', 'user_message', 'text_delta', 'reasoning', 'tool_call_started', 'turn_ended']);
const safeId = /^[0-9a-f-]{36}$/;

export function checkedTranscript(path, row) {
  if (typeof path !== 'string' || !path.startsWith('/') || !path.endsWith('.jsonl') ||
      /(?:^|[/\\])(?:\.env[^/\\]*|provider-homes|memories[^/\\]*|auth\.json)(?:[/\\]|$)/i.test(path)) return null;
  if (row) {
    const { cwd, cli, sessionId } = row;
    const native = cli === 'codex' ? path.endsWith(`-${sessionId}.jsonl`) && path.includes('/sessions/') :
      cli === 'claude' ? path.endsWith(`/${sessionId}.jsonl`) && path.includes('/projects/') :
        cli === 'agy' && path.includes(`/antigravity-cli/brain/${sessionId}/`) && /\/transcript(?:_full)?\.jsonl$/.test(path);
    if (!native && !path.startsWith(`${cwd}/`)) return null;
  }
  try { return realpathSync(path) === path && lstatSync(path).isFile() ? path : null; }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

export async function openOar(row, project, resume) {
  const runtime = registry.require(row.runtimeId);
  const env = { HC_TERMINAL_ID: null, LOOM_PROJECT: project, LOOM_ADDR: row.addr };
  let launchArgs;
  if (row.cli === 'codex') {
    launchArgs = ['-c', 'features.memories=false', '-c', 'sandbox_mode="workspace-write"', ...codexFastArgs(row.fast),
      '-c', 'check_for_update_on_startup=false', ...codexEnvironmentArgs(project, row.addr), '-c', `projects.${JSON.stringify(row.cwd)}.trust_level="trusted"`];
    if (process.env.CODEX_HOME && /(?:provider-homes|(?:^|\/)memories|(?:^|\/)\.env)/.test(process.env.CODEX_HOME)) {
      throw new Error('Unsupported CODEX_HOME for loom');
    }
  } else if (row.cli === 'agy') {
    Object.assign(env, { AGY_CLI_DISABLE_AUTO_UPDATE: 'true', GEMINI_HOME: null });
    launchArgs = ['--sandbox', '--log-file', eventPath(project, row.addr).replace(/\.jsonl$/, '.agy.log')];
  } else if (row.cli === 'claude') {
    Object.assign(env, { OAR_CLAUDE_BIN: nativeClaude(), CLAUDE_CODE_ENTRYPOINT: 'loom', DISABLE_AUTOUPDATER: '1' });
    launchArgs = ['--setting-sources', '', '--strict-mcp-config'];
    if (row.fast !== undefined) launchArgs.push('--settings', JSON.stringify({ fastMode: row.fast }));
  }
  const installation = await runtime.installation({ env });
  if (installation.kind !== 'available') throw new Error(`${row.cli} unavailable: ${installation.reason ?? installation.kind}`);
  const { cwd, model, effort } = row;
  return runtime.session(installation, { cwd, model, effort, env, launchArgs, ...(resume ? { resume } : {}) });
}

export async function bindOarTranscript(session, row) {
  const reported = checkedTranscript(await session.nativeSessionFile?.(), row);
  if (reported) return reported;
  return checkedTranscript(await adapters[row.cli]?.transcript.locate({ cwd: row.cwd, sessionId: session.id }), row);
}

export function trackOar(project, row, session, onError, incarnation) {
  const path = eventPath(project, row.addr);
  const rows = jsonRows(prepareJournal(path));
  let number = rows.reduce((max, event) => Math.max(max, event.turn ?? 0), 0);
  const streamId = randomUUID();
  let active;
  let pending;
  let nextHead;
  let seq = -1;
  let ordinal = 0;
  let failure = rows.findLast(event => ['stuck', 'recovered'].includes(event.type));
  failure = failure?.type === 'stuck' ? failure.reason : undefined;
  let suspending = false;

  const append = (event, type, fields = {}) => {
    if (seq !== event.seq) { seq = event.seq; ordinal = 0; }
    const item = { eventId: `${row.addr}:${streamId}:${seq}:${ordinal++}`, addr: row.addr, cwd: row.cwd,
      ...(incarnation && { incarnation, version: 1 }),
      streamId, seq, sessionId: session.id, at: event.receivedAt, type, ...fields };
    appendFileSync(path, JSON.stringify(item) + '\n', { mode: 0o600, flush: true,
      flag: constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW });
    rows.push(item);
  };

  function onEvent(event) {
    if (event.agentPath.length || event.sessionId !== session.id) return;
    if (event.kind === 'turn_started') {
      pending = { requestId: event.requestId, id: deliveryId(event.input), seq: event.seq };
      return;
    }
    if (event.kind === 'control_rejected' && pending?.requestId === event.requestId) {
      pending = undefined;
      return;
    }
    if (event.kind === 'exited' || event.kind === 'released' || event.kind.startsWith('compaction_')) {
      append(event, event.kind, event.kind.startsWith('compaction_') ? { outcome: event.outcome } : { suspending });
    }
    if (event.kind === 'input_dropped' && event.inputId) {
      append(event, 'input-dropped', { inputId: event.inputId });
    }
    if (!active && activeEvents.has(event.kind)) {
      const turn = ++number;
      const status = session.status().value;
      const sinceSeq = pending?.seq ?? status.sinceSeq ?? event.seq;
      const turnId = event.spanId ?? event.turnId ?? `${streamId}:${turn}`;
      const start = nextHead ?? headAt(row.cwd);
      active = { sinceSeq, turnId, turn, since: event.receivedAt, inputIds: new Set(), text: '', start };
      append(event, 'turn-start', { turn, turnId, sinceSeq, ...start });
      nextHead = undefined;
    }
    if (!active) return;
    active.nativeTurnId ??= event.spanId ?? event.turnId;
    const { turnId, turn, sinceSeq } = active;
    const identified = [...(event.inputIds ?? []), event.inputId, event.kind === 'user_message' && deliveryId(event.input)]
      .filter(id => typeof id === 'string' && safeId.test(id));
    // Some ACP versions omit the input ID. Native activity in this exact
    // prompt slot proves the prompt took effect before its final response.
    const acpSlot = activeEvents.has(event.kind) && acpProviders.has(row.cli) &&
      pending?.id && sinceSeq === pending.seq;
    if (acpSlot && !identified.length && (event.kind !== 'turn_ended' || event.outcome.kind !== 'failed' ||
        rateFailure.has(event.outcome.failure))) {
      identified.push(pending.id);
    }
    if (acpSlot || ['turn_active', 'user_message', 'turn_ended'].includes(event.kind)) {
      for (const id of identified) {
        if (active.inputIds.has(id)) continue;
        active.inputIds.add(id);
        append(event, 'input-received', { inputId: id, turnId, turn, sinceSeq });
      }
    }
    if (event.kind === 'tool_call_started' && row.cli !== 'codex') active.text = '';
    if (event.kind === 'text_delta' && (row.cli !== 'codex' || event.phase === 'final_answer')) {
      if (event.messageId !== active.messageId) active.text = '';
      active.messageId = event.messageId;
      active.text += event.text;
    }
    if (['tool_call_started', 'tool_call_input', 'tool_call_ended'].includes(event.kind)) {
      append(event, event.kind, { turnId, turn, callId: event.callId, tool: event.toolName ?? event.tool,
        input: event.input, exitCode: event.exitCode, result: event.result,
        content: event.content?.filter(part => part.type === 'text') });
    }
    if (event.kind === 'usage') append(event, 'usage', { turn, usage: event.usage });
    if (event.kind !== 'turn_ended') return;
    const outcome = event.outcome;
    const reason = rateFailure.has(outcome.failure) ? 'rate-limit' : outcome.failure === 'auth' ? 'auth' : undefined;
    if (reason && failure !== reason) append(event, 'stuck', { reason, turn });
    if (!reason && failure) append(event, 'recovered', { reason: failure, turn });
    failure = reason;
    const text = outcome.kind === 'completed' && active.text.trim() ? active.text : null;
    const unconfirmed = outcome.kind === 'completed' && acpProviders.has(row.cli);
    append(event, 'turn-end', {
      turn, turnId, nativeTurnId: active.nativeTurnId, sinceSeq, outcome, inputIds: [...active.inputIds],
      ...finishHead(project, row, active.start),
      ...(outcome.kind === 'aborted' && { interruptedBy: active.interruptedBy ?? outcome.by ?? null }),
      finalReply: unconfirmed ? null : text,
      ...(unconfirmed && { unconfirmed: true, unconfirmedBody: text }),
    });
    active = pending = undefined;
  }

  let error;
  append({ seq: -1, receivedAt: Date.now() }, 'stream-opened');
  const unsubscribe = session.events(event => {
    if (error) return;
    try { onEvent(event); }
    catch (failure) { error ??= failure; onError(failure); }
  }, { cursor: { sessionId: session.id, afterSeq: session.records().at(-1)?.seq ?? -1 } });
  function clearInactive() {
    if (!active) return;
    const { turn, turnId, sinceSeq } = active;
    append({ seq, receivedAt: Date.now() }, 'turn-unconfirmed', { turn, turnId, sinceSeq });
    active = pending = undefined;
  }
  return { session, streamId, rows, active: () => active, clearInactive, unsubscribe,
    sampleInputHead: () => { nextHead = headAt(row.cwd); },
    noteAbort: () => {
      const turn = active;
      if (turn) turn.interruptedBy = 'loom';
      return () => { if (turn) delete turn.interruptedBy; };
    },
    error: () => error, suspend: () => { suspending = true; } };
}

export function oarSnapshot(runtime, events, ended) {
  const status = runtime?.session.status().value;
  const state = ended || status?.released ? 'finished' : !status ? 'unknown' :
    status.kind === 'running' ? 'busy' : 'idle';
  const current = runtime?.active();
  const active = status?.kind === 'running' ? {
    hcTurn: current?.turn ?? events.findLast(event => event.type === 'turn-start')?.turn ?? 0,
    streamId: runtime.streamId, sinceSeq: current?.sinceSeq ?? status.sinceSeq, turnId: current?.turnId,
    since: current?.since ?? status.lastEventAt,
  } : undefined;
  return { state, terminal: { turn: current?.turn ?? events.findLast(event => event.type === 'turn-end')?.turn ?? 0 },
    active, events, strictEnd: true, runtimeStatus: status, streamId: runtime?.streamId };
}

export function oarEnd(frame, observation) {
  const stop = observation.events.find(event => event.type === 'turn-end' &&
    event.streamId === frame.streamId && event.sinceSeq === frame.sinceSeq &&
    (!frame.turnId || event.turnId === frame.turnId));
  return stop && { at: stop.at, canceled: stop.outcome.kind === 'aborted' };
}

export function oarDelivery(message, observation) {
  const events = observation.events.filter(event => event.at >= message.attemptAt);
  const start = events.find(event => event.type === 'input-received' && event.inputId === message.id);
  const end = events.find(event => event.type === 'turn-end' && (event.inputIds?.includes(message.id) ||
    (start && start.turnId === event.turnId && start.streamId === event.streamId)));
  if (!start && !end) {
    if (events.some(event => event.type === 'input-dropped' && event.inputId === message.id)) return { dropped: true };
    return;
  }
  const { at, sessionId, turnId, streamId } = start ?? end;
  return { at, sessionId, turnId, streamId, ...(end && { completion: {
    at: end.at, sessionId, turnId, nativeTurnId: end.nativeTurnId, nativeTurnIndex: end.turn,
    source: 'OAR turn-end', outcome: end.outcome,
    ...(end.unconfirmed || message.target?.provider && acpProviders.has(message.target.provider) && end.outcome.kind === 'completed' ?
      { noReply: true, unconfirmed: true, unconfirmedBody: end.unconfirmedBody ?? end.finalReply } :
      end.finalReply ? { body: end.finalReply } : { noReply: true }),
  } }) };
}

export async function oarControl(runtime, action, message, observation) {
  if (!runtime || runtime.error()) throw Object.assign(new Error('OAR session unavailable'), { kind: 'blocked' });
  const { session } = runtime;
  const snapshot = oarSnapshot(runtime, runtime.rows, false);
  const guarded = action !== 'prompt';
  if (guarded && (!snapshot.active || snapshot.active.sinceSeq !== message.active?.sinceSeq ||
      snapshot.active.streamId !== message.active.streamId)) {
    throw Object.assign(new Error('Target turn has ended'), { kind: action === 'steer' ? 'steer-unavailable' : 'status_mismatch' });
  }
  if (!guarded && (snapshot.state !== 'idle' || observation.state !== 'idle')) {
    throw Object.assign(new Error('Session busy'), { kind: 'status_mismatch' });
  }
  if (action === 'steer' && !session.steer) {
    throw Object.assign(new Error('Steer unavailable'), { kind: 'steer-unavailable' });
  }
  if (!guarded) {
    runtime.clearInactive();
    runtime.sampleInputHead();
  }
  const undoAbort = action === 'abort' ? runtime.noteAbort?.() : null;
  let result;
  try {
    result = action === 'abort' ? await session.abort() :
      await session[action](wireText(message.id, message.text), { inputId: message.id });
  } catch (error) {
    undoAbort?.();
    throw error;
  }
  if (result.kind === 'accepted') return result;
  undoAbort?.();
  const kind = action === 'steer' && ['unsupported', 'no_active_turn'].includes(result.code) ? 'steer-unavailable' :
    ['busy', 'no_active_turn', 'disposed'].includes(result.code) ? 'status_mismatch' :
      ['runtime_exited', 'runtime_refused', 'error'].includes(result.code) ? undefined : 'input-refused';
  throw Object.assign(new Error(`OAR ${action}: ${result.code}`), { kind });
}
