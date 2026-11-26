import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, isAbsolute, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import agy from '../adapters/agy/index.mjs';
import { parseAgyTranscriptLine } from '../adapters/agy/transcript.mjs';
import claude from '../adapters/claude/index.mjs';
import codex from '../adapters/codex/index.mjs';
import { parseCodexTranscriptLine } from '../adapters/codex/transcript.mjs';
import opencode from '../adapters/opencode/index.mjs';
import { boundTranscript, finalFromStop, terminalEvents, withClaudeTranscriptStops } from '../relay/sources.mjs';
import { agyDeliveryParts, checksDeliveryIntegrity, claudeDigestVersion, claudeNativeDigest, deliveryId, payloadDigest } from './message.mjs';
import { controlTui } from '../runtimes/tui/transport.mjs';
import { screenPrompt } from '../adapters/prompt-state.mjs';
import { corroboratePrompt, hcStatus } from '../adapters/hc-status.mjs';
import { readRequestBook } from '../tui/request-book.mjs';

const exec = promisify(execFile);
const adapters = new Map([agy, claude, codex, opencode].map(adapter => [adapter.id, adapter]));
export const addressPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const refusals = new Set(['blocked', 'status_mismatch', 'finished', 'not_found', 'human-active', 'frame-changed']);

export const hc = (command, ...args) => hcAt('hc', command, ...args);

export async function hcAt(executable, command, ...args) {
  try {
    const { stdout } = await exec(executable, [command, '--json', ...args], {
      timeout: 5_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    let kind;
    try { kind = JSON.parse(error.stderr).error.kind; } catch { /* No structured refusal. */ }
    const detail = kind ?? error.code ?? 'unknown result';
    throw Object.assign(new Error(`hc ${command} ${args[0]}: ${detail}`), { kind });
  }
}

const session = row => row.session_id ?? row.conversationId;
const start = (provider, row) => provider === 'agy' ?
  row.hook_event_name === 'PreInvocation' && Number(row.invocationNum ?? 0) === 0 :
  row.hook_event_name === 'UserPromptSubmit';

function end(provider, row) {
  if (row.paused || row.fullyIdle === false) return false;
  return provider === 'agy' ?
    row.fullyIdle === true && row.executionNum != null :
    ['Stop', 'StopFailure', 'Interrupt'].includes(row.hook_event_name);
}

const canceled = row => row.hook_event_name === 'Interrupt' || row.is_interrupt === true ||
  /CANCEL|INTERRUPT|ABORT/.test(row.terminationReason ?? '');

function inside(project, cwd) {
  const path = relative(project, cwd);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

export function inputPlan(provider, requested) {
  const adapter = adapters.get(provider);
  const capabilities = adapter.capabilities;
  const mode = requested === 'steer' ? 'queue' : requested;
  if (mode === 'interrupt' && !(capabilities.interrupt && capabilities.resumeSamePane)) throw new Error('interrupt is unsupported');
  const plan = adapter.input.plan(mode);
  // The wrapper implements the text step and Enter as a single guarded transaction.
  const submit = plan.steps.findIndex(step => step.type === 'text');
  const text = plan.steps[submit];
  const enter = plan.steps[submit + 1];
  if (!text || !(text.submit || (enter?.type === 'key' && enter.key === 'enter'))) {
    throw new Error(`unsupported ${provider} submit plan`);
  }
  const stop = plan.steps.slice(0, submit).flatMap(step => step.type === 'keys' ? step.keys : step.type === 'key' ? [step.key] : []);
  return { mode: plan.mode, stop };
}

function activeTurn(terminal, current) {
  if (!current) return;
  return {
    hcTurn: terminal.turn,
    since: current.receivedAt, sessionId: session(current), turnId: current.turn_id ?? current.prompt_id,
  };
}

export function sameTurn(frame, current) {
  if (frame?.pty) return Boolean(current?.pty && frame.sessionId === current.sessionId &&
    frame.since === current.since && frame.turnId === current.turnId);
  if (!current || current.hcTurn !== frame.hcTurn) return false;
  if (frame.turnId && current.turnId) return current.turnId === frame.turnId && current.sessionId === frame.sessionId;
  return current.since === frame.since;
}

function book(observation) {
  return observation.book ??= observation.tui?.bookPath ? readRequestBook(observation.tui.bookPath) : new Map();
}

export function turnEnd(frame, observation) {
  if (frame.pty && observation.tui?.bookPath) {
    const abort = [...book(observation).values()].find(entry =>
      entry.receipt?.kind === 'confirmed' &&
      entry.active?.sessionId === frame.sessionId && entry.active.since === frame.since &&
      entry.active.turnId === frame.turnId);
    if (abort) return { at: abort.receipt.at, canceled: true };
  }
  const stop = observation.events.findLast(row => end(observation.provider, row) && row.receivedAt >= frame.since &&
    (!frame.sessionId || session(row) === frame.sessionId) && (!frame.turnId ||
      String(row.turn_id ?? row.prompt_id ?? row.executionNum ?? '') === frame.turnId ||
      row.backgroundPromptId === frame.turnId ||
      frame.pty && observation.provider === 'claude' && !row.turn_id && !row.prompt_id));
  if (stop) return { at: stop.receivedAt, canceled: canceled(stop) };
}

function nativeInputState(provider, events) {
  const currentSession = session(events.at(-1) ?? {});
  let opened;
  let compacting = false;
  let state = 'unknown';
  let proof;
  let background = false;
  for (const event of events) {
    if (session(event) !== currentSession) continue;
    const kind = event.hook_event_name;
    if (kind === 'SessionStart' && event.source === 'compact') continue;
    if (kind === 'SessionStart' || kind === 'SessionEnd') {
      opened = undefined;
      background = false;
      compacting = false;
      state = kind === 'SessionStart' ? 'idle' : 'unknown';
    } else if (kind === 'PreCompact' || kind === 'PostCompact') {
      compacting = kind === 'PreCompact';
    } else if (start(provider, event)) {
      opened = event;
      background = false;
      state = 'busy';
    } else if (kind === 'PreToolUse' || kind === 'PostToolUse') {
      opened ??= event;
      state = 'busy';
    } else if (event.paused || kind === 'Stop' && event.fullyIdle === false) {
      opened ??= event;
      background = true;
      state = 'busy';
    } else if (end(provider, event)) {
      const expected = opened?.turn_id ?? opened?.prompt_id ?? opened?.executionNum;
      const actual = event.turn_id ?? event.prompt_id ?? event.executionNum;
      if (expected !== undefined && actual !== undefined && String(expected) !== String(actual)) continue;
      opened = undefined;
      background = false;
      state = 'idle';
    } else {
      continue;
    }
    proof = { event: kind, at: event.receivedAt, turnId: event.turn_id ?? event.prompt_id };
  }
  return { state: compacting ? 'busy' : state, proof, opened, background };
}

function transcriptContains(provider, rows, stop, id) {
  if (provider === 'codex') {
    let turn;
    return rows.some(row => {
      const payload = row.payload;
      if (payload?.type === 'task_started') turn = payload.turn_id;
      if (turn !== stop.turn_id) return false;
      return (payload?.type === 'user_message' && deliveryId(payload.message) === id) ||
        parseCodexTranscriptLine(row).some(item => item.kind === 'user' && deliveryId(item.text) === id);
    });
  }
  if (provider === 'agy') {
    const user = rows.filter(row => Date.parse(row.created_at) <= stop.receivedAt)
      .flatMap(parseAgyTranscriptLine).findLast(item => item.kind === 'user');
    return deliveryId(user?.text) === id;
  }
  return false;
}

function agyIntegrityRecords(observation) {
  if (observation.agyIntegrity) return observation.agyIntegrity;
  const records = observation.agyIntegrity = new Map();
  const binding = observation.events.findLast(row => row.transcriptPath ?? row.transcript_path);
  if (!binding) return records;
  const nativeId = session(binding);
  const expected = id => book(observation).get(id)?.digest;
  for (const row of boundTranscript('agy', observation.terminal, binding)) {
    const text = parseAgyTranscriptLine(row, { preserveUserWhitespace: true }).find(item => item.kind === 'user')?.text;
    const parts = agyDeliveryParts(text, expected);
    if (!parts.length) continue;
    const writtenAt = Date.parse(row.created_at ?? row.timestamp);
    if (!Number.isFinite(writtenAt)) continue;
    const hook = observation.events.find(event => session(event) === nativeId && start('agy', event) &&
      (event.deliveryId ?? deliveryId(event.prompt)) === parts[0].id && Math.abs(event.receivedAt - writtenAt) <= 5000);
    const at = Math.max(writtenAt, hook?.receivedAt ?? 0);
    for (const part of parts) if (!records.has(part.id)) records.set(part.id, { digest: part.digest, at,
      sessionId: nativeId, turnId: hook?.turn_id ?? hook?.prompt_id });
  }
  return records;
}

export function nativeDelivery(message, observation) {
  const { provider, terminal } = observation;
  const events = observation.events.filter(row => row.receivedAt >= message.attemptAt);
  const anchor = events.find(row => start(provider, row) && (row.deliveryId ?? deliveryId(row.prompt)) === message.id);
  const entry = book(observation).get(message.id);
  const confirmation = entry?.confirmation;
  const integrity = checksDeliveryIntegrity({ provider, tui: observation.tui });
  const agyRecord = integrity && provider === 'agy' && agyIntegrityRecords(observation).get(message.id);
  const confirmed = !anchor && (confirmation?.at >= message.attemptAt ?
    { at: confirmation.at, sessionId: confirmation.sessionId, turnId: confirmation.turnId } :
    agyRecord?.at >= message.attemptAt ? agyRecord : undefined);
  const receiptFor = row => ({ at: row.receivedAt, sessionId: session(row), turnId: row.turn_id ?? row.prompt_id });
  const agyReceipt = provider === 'agy' && (anchor ? receiptFor(anchor) : confirmed ?? message.received);
  // Agy's root PreInvocation can omit the marker for human inputs. A later
  // user step in the same conversation ends our claim on subsequent Stops.
  const newer = agyReceipt?.sessionId && events.find(row =>
    row.receivedAt > agyReceipt.at && session(row) === agyReceipt.sessionId && start('agy', row) &&
    (row.deliveryId ?? deliveryId(row.prompt)) !== message.id &&
    !(Number.isSafeInteger(anchor?.initialNumSteps) && Number.isSafeInteger(row.initialNumSteps) &&
      row.initialNumSteps <= anchor.initialNumSteps));
  const stops = events.filter(row => end(provider, row));
  const transcript = new Map();
  const rows = stop => {
    if (!transcript.has(stop)) transcript.set(stop, boundTranscript(provider, terminal, stop));
    return transcript.get(stop);
  };
  const claudeTurns = new Map();
  const sequentialStop = provider === 'claude' && anchor && message.mode !== 'steer' &&
    events.slice(events.indexOf(anchor) + 1).find(row => start(provider, row) || end(provider, row));
  function claudeTurn(stop) {
    if (!claudeTurns.has(stop)) {
      const text = rows(stop).filter(row => !(Date.parse(row.timestamp) > stop.receivedAt))
        .map(row => JSON.stringify(row)).join('\n');
      claudeTurns.set(stop, claude.transcript.parse(text).turns.at(-1));
    }
    return claudeTurns.get(stop);
  }
  const stop = stops.find(row => {
    if (provider === 'claude' && row.backgroundDeliveryIds?.includes(message.id)) {
      return session(row) === (anchor ? session(anchor) : message.received?.sessionId ?? confirmed?.sessionId);
    }
    if (provider === 'agy' && agyReceipt?.sessionId &&
        (session(row) !== agyReceipt.sessionId || row.receivedAt < agyReceipt.at ||
          anchor && events.indexOf(row) <= events.indexOf(anchor))) return false;
    if (row.deliveryId === message.id) return true;
    if (anchor && provider === 'codex') return session(row) === session(anchor) && row.turn_id === anchor.turn_id &&
      events.indexOf(row) > events.indexOf(anchor);
    if (provider === 'claude') {
      if (anchor && (session(row) !== session(anchor) || events.indexOf(row) <= events.indexOf(anchor))) return false;
      const anchorTurn = anchor?.turn_id ?? anchor?.prompt_id;
      const stopTurn = row.turn_id ?? row.prompt_id;
      if (anchorTurn && stopTurn) return stopTurn === anchorTurn;
      if (row === sequentialStop) return true;
      return claudeTurn(row)?.prompts.some(prompt => deliveryId(prompt) === message.id);
    }
    if (provider === 'agy') {
      if (row.deliveryId || newer && row.receivedAt >= newer.receivedAt) return false;
      if (agyReceipt?.sessionId) return true;
    }
    return transcriptContains(provider, rows(row), row, message.id);
  });
  const resumed = stop?.backgroundDeliveryIds?.includes(message.id);
  const receipt = anchor ?? (resumed ? undefined : stop);
  const result = !anchor && stop?.hookGap && (confirmed ?? message.received) ||
    (receipt ? receiptFor(receipt) : confirmed ?? (resumed ? message.received : agyReceipt));
  if (!result) return;
  if (integrity) {
    const expected = message.payloadDigest ?? entry?.digest ?? payloadDigest(message.text);
    const recorded = confirmation?.at >= message.attemptAt ? confirmation.digests ?? [] : [];
    const hookDigest = provider === 'claude' && claudeNativeDigest(anchor?.prompt, message.id, expected);
    const known = (provider === 'claude' ? [hookDigest,
      ...recorded.filter(digest => confirmation.digestVersion === claudeDigestVersion || digest === expected)] :
      [agyRecord?.at >= message.attemptAt && agyRecord.digest, ...recorded]).filter(Boolean);
    const mismatch = known.find(value => value !== expected &&
      !(provider === 'agy' && message.compatibleDigests?.includes(value)));
    if (mismatch) return { ...result, corrupted: { expected, observed: mismatch,
      ...(provider === 'claude' && { digestVersion: claudeDigestVersion }) } };
    if (!known.length) return;
    result.payloadVerified = true;
  }
  if (!stop) {
    const abort = observation.tui?.bookPath && [...book(observation).values()].find(entry =>
      entry.receipt?.kind === 'confirmed' && entry.active?.inputId === message.id &&
      entry.active.sessionId === result.sessionId);
    const at = abort?.receipt.at ?? newer?.receivedAt;
    return at == null ? result : { ...result, completion: { ...result, at, noReply: true,
      source: abort ? 'loom-pty confirmed interruption' : 'agy newer root PreInvocation' } };
  }
  const completion = receiptFor(stop);
  if (canceled(stop) || stop.hook_event_name === 'StopFailure' || stop.error) {
    return { ...result, completion: { ...completion, noReply: true, source: `${provider} native ${stop.hook_event_name}` } };
  }
  let reply;
  if (provider === 'claude' && stop.backgroundDeliveryIds?.includes(message.id)) {
    return { ...result, completion: { ...completion, nativeTurnId: stop.nativeTurnId, source: 'claude task-notification',
      ...(stop.backgroundReply ? { body: stop.backgroundReply } : { noReply: true }) } };
  }
  if (provider === 'claude' && stop.hookGap) {
    return { ...result, completion: { ...completion, source: stop.source,
      ...(stop.last_assistant_message ? { body: stop.last_assistant_message } : { noReply: true }) } };
  }
  const agyAttributed = provider === 'agy' &&
    (stop.deliveryId === message.id || transcriptContains(provider, rows(stop), stop, message.id));
  if (provider === 'opencode' && stop.last_assistant_message?.trim()) {
    reply = { body: stop.last_assistant_message, source: 'OpenCode session export' };
  } else if (provider === 'codex' && stop.last_assistant_message) {
    reply = finalFromStop(provider, stop, []);
  } else if (provider === 'claude') {
    const turn = claudeTurn(stop);
    if (turn?.prompts.some(prompt => deliveryId(prompt) === message.id) && turn.reply) {
      reply = { body: turn.reply, source: 'claude Stop + transcript' };
    } else if ((stop === sequentialStop || result.turnId && completion.turnId === result.turnId) && stop.last_assistant_message?.trim()) {
      reply = { body: stop.last_assistant_message, source: 'claude Stop' };
    }
  } else if (provider !== 'agy' || agyAttributed) {
    reply = finalFromStop(provider, stop, rows(stop));
  }
  // agy reports the final reply in its native done status. Use it only while
  // that status still belongs to this Stop, with no subsequent root invocation.
  if (!reply && agyAttributed && stop === observation.events.findLast(row => start(provider, row) || end(provider, row)) &&
    terminal.status?.state === 'done' && terminal.status_ms >= stop.receivedAt && terminal.status.msg?.trim()) {
    reply = { body: terminal.status.msg, source: 'agy Stop + hc done' };
  }
  if (!reply && provider === 'agy') return { ...result, completion: { ...completion, noReply: true, source: 'agy native Stop' } };
  return { ...result, completion: { ...completion, ...reply } };
}

export function tui(project, call = hc, fixtureSend, control = controlTui) {
  async function observe(terminal, provider, sessionId, binding) {
    let events = terminalEvents(project, terminal.address, terminal, sessionId ?? binding?.evidence?.sessionId)
      .filter(row => !row.agent_id && session(row) && (!sessionId || session(row) === sessionId));
    if (provider === 'claude') events = withClaudeTranscriptStops(terminal, events, sessionId);
    const lastStop = provider === 'claude' && events.findLast(event => !event.paused &&
      ['Stop', 'StopFailure', 'Interrupt'].includes(event.hook_event_name));
    const hookGap = lastStop?.hookGap && { at: lastStop.receivedAt, source: 'transcript' };
    const osc = hcStatus(terminal, provider);
    const snapshot = { terminal, events, provider, tui: binding, strictEnd: true, ...(hookGap && { hookGap }), ...(osc && { hcStatus: osc }) };
    if (terminal.state === 'finished') return { ...snapshot, state: 'finished' };
    const native = nativeInputState(provider, events);
    if (['loom-pty', 'holder-v3'].includes(binding?.transport)) {
      const status = terminal.status?.state;
      let frame;
      try { frame = await control(binding, 'state', undefined, terminal.address); }
      catch (error) {
        const fallback = await call('read', terminal.address, '--lines', '0').catch(() => undefined);
        const visible = terminal.screen !== 'inexact' && fallback?.complete === true &&
          fallback.how === 'screen' && typeof fallback.text === 'string';
        const kind = visible ? adapters.get(provider).screen.classify(fallback.text) : 'unknown';
        const details = visible && corroboratePrompt(screenPrompt(kind, fallback.text), osc, native.proof?.at);
        return { ...snapshot, state: details?.kind ?? 'unknown',
          ...(visible && { livenessScreen: { kind, text: fallback.text } }),
          ...(details && { userPrompt: { ...details, cli: provider, source: 'screen' } }), writeEvidence: {
          transport: binding.transport, screen: 'unavailable', hc: status ?? null, reason: error.code ?? 'control-unavailable',
        } };
      }
      const { screen, host, native: holderNative } = frame;
      const fallback = screenPrompt(screen.kind, screen.text ?? '');
      const userPrompt = corroboratePrompt(frame.userPrompt ?? (fallback && { ...fallback, cli: provider, source: 'screen' }),
        osc, native.proof?.at);
      const active = frame.phase === 'busy' && holderNative.activeSince !== undefined && {
        pty: true, hcTurn: terminal.turn, since: holderNative.activeSince, sessionId: holderNative.sessionId, turnId: holderNative.activeTurn,
      };
      const veto = ['working', 'blocked', 'error'].includes(status);
      const state = frame.exit ? 'finished' : userPrompt?.kind ?? frame.blocker ?? (native.background ? 'busy' : frame.ready && !veto ? 'idle' :
        ['blocked', 'error'].includes(status) ? 'blocked' : screen.kind === 'busy' && active ? 'busy' :
          ['idle', 'busy'].includes(screen.kind) ? 'unknown' : screen.kind);
      return { ...snapshot, state, active, generation: host.generation, livenessScreen: screen,
        ...(frame.exit && { exit: frame.exit }),
        ...(userPrompt && !frame.exit && { userPrompt }), urgentReady: !userPrompt && frame.urgentReady && !veto, writeEvidence: {
        transport: binding.transport, screen: screen.kind, native: native.background ? 'background-in-progress' : holderNative.phase ?? 'unknown', hc: status ?? null,
        complete: screen.text !== undefined, humanActive: host.humanActive, composerEmpty: screen.empty,
        pendingDeliveryId: frame.pending, submittedDeliveryId: frame.submittedDeliveryId,
        retryableDeliveryId: frame.retryableDeliveryId,
        ...(frame.heldDraftProof && { heldDraftProof: frame.heldDraftProof, heldDeliveryId: frame.pending,
          heldDraftBytes: frame.heldDraftBytes }),
      } };
    }
    const readOnly = binding?.transport === 'plain-hc' || (!fixtureSend && binding);
    const frame = await call('read', terminal.address, '--lines', '0').catch(error => {
      if (!readOnly) throw error;
    });
    const visible = terminal.screen !== 'inexact' && frame?.complete === true &&
      frame.how === 'screen' && typeof frame.text === 'string';
    const screen = visible ? adapters.get(provider).screen.classify(frame.text) : 'unknown';
    const status = terminal.status?.state;
    const details = corroboratePrompt(screenPrompt(screen, frame?.text ?? ''), osc, native.proof?.at);
    const userPrompt = details && { ...details, cli: provider, source: 'screen' };
    const livenessScreen = visible ? { kind: screen, text: frame.text } : undefined;
    if (readOnly) return { ...snapshot, state: userPrompt?.kind ?? 'blocked', livenessScreen, ...(userPrompt && { userPrompt }),
      writeEvidence: { transport: binding.transport ?? 'legacy-hc', reason: binding.reason ?? 'control-unavailable' } };
    let state = screen;
    if (status === 'blocked' || status === 'error') state = 'blocked';
    else if (['idle', 'busy', 'unknown'].includes(screen)) {
      if (native.background) state = 'busy';
      else if (screen === 'idle' && native.state === 'idle' && status !== 'working') state = 'idle';
      else if (screen === 'busy' && native.state === 'busy' && !['idle', 'done'].includes(status)) state = 'busy';
      else state = 'unknown';
    }
    const active = native.state === 'busy' ? activeTurn(terminal, native.opened) : undefined;
    const writeEvidence = { screen, native: native.state, hc: status ?? null, complete: visible, proof: native.proof };
    return { ...snapshot, state: userPrompt?.kind ?? state, active, writeEvidence, livenessScreen, ...(userPrompt && { userPrompt }) };
  }

  async function resolve(target) {
    const terminal = await call('get', target);
    const cwd = realpathSync(terminal.cwd);
    if (!inside(project, cwd)) throw new Error(`target is outside this project: ${target}`);
    const app = terminal.status?.app;
    const provider = terminal.labels?.['loom-cli'] ??
      (app === 'antigravity' ? 'agy' : adapters.has(app) ? app : basename(terminal.argv?.[0] ?? ''));
    if (!addressPattern.test(terminal.address) || !adapters.has(provider)) throw new Error(`unsupported TUI target: ${target}`);
    const binding = { addr: terminal.address, createdAt: terminal.created_ms, pid: terminal.pid, cwd, provider };
    return { binding, observation: await observe(terminal, provider) };
  }

  async function inspect(binding) {
    const terminal = await call('get', binding.addr);
    if (terminal.address !== binding.addr || terminal.created_ms !== binding.createdAt ||
      (binding.pid && terminal.pid !== binding.pid) || realpathSync(terminal.cwd) !== binding.cwd) {
      throw new Error(`pane identity changed: ${binding.addr}`);
    }
    return observe(terminal, binding.provider, binding.sessionId, binding.tui ?? (fixtureSend ? undefined : {}));
  }

  async function send(message, snapshot, retry = false) {
    if (message.mode === 'steer') throw Object.assign(new Error('TUI steer requires queueing'), { kind: 'steer-unavailable' });
    if (fixtureSend && !snapshot.tui) return fixtureSend(message, snapshot);
    if (!snapshot.tui || snapshot.state !== 'idle' && !(message.urgent && snapshot.urgentReady) &&
        !(retry && snapshot.writeEvidence?.retryableDeliveryId === message.id)) {
      throw Object.assign(new Error('TUI control is unavailable or blocked'), { kind: 'blocked' });
    }
    const result = await control(snapshot.tui, 'submit', {
      id: message.id, text: message.text, generation: snapshot.generation, timeoutMs: 900, urgent: message.urgent, retry,
    }, snapshot.terminal.address).catch(error => {
      if (error.code === 'INPUT_SIZE') error.kind = 'input-refused';
      throw error;
    });
    if (result.kind !== 'confirmed') {
      const kind = result.kind === 'unconfirmed' && result.hostReceipt?.accepted === true ? 'no-native-turn' :
        result.kind !== 'refused' || result.code === 'previous-input-unconfirmed' ? 'unconfirmed' :
        ['invalid-input', 'id-conflict'].includes(result.code) ? 'input-refused' :
          result.code === 'human-active' || result.code === 'frame-changed' ? result.code : 'blocked';
      throw Object.assign(new Error(`TUI submit ${result.code ?? result.kind}`), { kind });
    }
    return result;
  }

  return {
    resolve, inspect, send, sameTurn, turnEnd, nativeDelivery, plan: inputPlan,
    retryMissingTurn: (message, snapshot) => send(message, snapshot, true),
    async interrupt(message, snapshot) {
      if (!snapshot?.tui?.socket) {
        throw Object.assign(new Error('TUI does not support guarded interruption'), { kind: 'input-refused' });
      }
      if (!sameTurn(message.active, snapshot.active)) {
        throw Object.assign(new Error('TUI turn changed before interruption'), { kind: 'blocked' });
      }
      const { since, turnId, sessionId } = message.active;
      const result = await control(snapshot.tui, 'interrupt', {
        id: message.id, generation: snapshot.generation, turnAt: since, sessionId, turnId,
      }, snapshot.terminal.address);
      if (result.kind !== 'confirmed') {
        throw Object.assign(new Error(`TUI interrupt ${result.code ?? result.kind}`), {
          kind: result.kind === 'refused' ? 'blocked' : 'unconfirmed',
        });
      }
    },
  };
}
