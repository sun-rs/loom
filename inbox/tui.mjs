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
import { boundTranscript, finalFromStop, terminalEvents } from '../relay/sources.mjs';
import { deliveryId } from './message.mjs';
import { controlTui } from '../runtimes/tui/transport.mjs';
import { readRequestBook } from '../tui/request-book.mjs';

const exec = promisify(execFile);
const adapters = new Map([agy, claude, codex, opencode].map(adapter => [adapter.id, adapter]));
export const addressPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
export const refusals = new Set(['blocked', 'status_mismatch', 'finished', 'not_found', 'human-active', 'frame-changed']);

export async function hc(command, ...args) {
  try {
    const { stdout } = await exec('hc', [command, '--json', ...args], {
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
    since: current.receivedAt, sessionId: session(current), turnId: current.turn_id,
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
      frame.pty && observation.provider === 'claude' && !row.turn_id && !row.prompt_id));
  if (stop) return { at: stop.receivedAt, canceled: canceled(stop) };
}

function nativeInputState(provider, events) {
  const currentSession = session(events.at(-1) ?? {});
  let opened;
  let compacting = false;
  let state = 'unknown';
  let proof;
  for (const event of events) {
    if (session(event) !== currentSession) continue;
    const kind = event.hook_event_name;
    if (kind === 'SessionStart' && event.source === 'compact') continue;
    if (kind === 'SessionStart' || kind === 'SessionEnd') {
      opened = undefined;
      compacting = false;
      state = kind === 'SessionStart' ? 'idle' : 'unknown';
    } else if (kind === 'PreCompact' || kind === 'PostCompact') {
      compacting = kind === 'PreCompact';
    } else if (start(provider, event)) {
      opened = event;
      state = 'busy';
    } else if (kind === 'PreToolUse' || kind === 'PostToolUse') {
      opened ??= event;
      state = 'busy';
    } else if (end(provider, event)) {
      const expected = opened?.turn_id ?? opened?.executionNum;
      const actual = event.turn_id ?? event.executionNum;
      if (expected !== undefined && actual !== undefined && String(expected) !== String(actual)) continue;
      opened = undefined;
      state = 'idle';
    } else {
      continue;
    }
    proof = { event: kind, at: event.receivedAt, turnId: event.turn_id };
  }
  return { state: compacting ? 'busy' : state, proof, opened };
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

export function nativeDelivery(message, observation) {
  const { provider, terminal } = observation;
  const events = observation.events.filter(row => row.receivedAt >= message.attemptAt);
  const anchor = events.find(row => start(provider, row) && (row.deliveryId ?? deliveryId(row.prompt)) === message.id);
  const confirmation = !anchor && book(observation).get(message.id)?.confirmation;
  const confirmed = confirmation?.at >= message.attemptAt ?
    { at: confirmation.at, sessionId: confirmation.sessionId, turnId: confirmation.turnId } : undefined;
  const receiptFor = row => ({ at: row.receivedAt, sessionId: session(row), turnId: row.turn_id });
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
    if (provider === 'agy' && agyReceipt?.sessionId &&
        (session(row) !== agyReceipt.sessionId || row.receivedAt < agyReceipt.at ||
          anchor && events.indexOf(row) <= events.indexOf(anchor))) return false;
    if (row.deliveryId === message.id) return true;
    if (anchor && provider === 'codex') return session(row) === session(anchor) && row.turn_id === anchor.turn_id &&
      events.indexOf(row) > events.indexOf(anchor);
    if (provider === 'claude') {
      if (anchor && (session(row) !== session(anchor) || events.indexOf(row) <= events.indexOf(anchor))) return false;
      if (anchor?.turn_id && row.turn_id) return row.turn_id === anchor.turn_id;
      if (row === sequentialStop) return true;
      return claudeTurn(row)?.prompts.some(prompt => deliveryId(prompt) === message.id);
    }
    if (provider === 'agy') {
      if (row.deliveryId || newer && row.receivedAt >= newer.receivedAt) return false;
      if (agyReceipt?.sessionId) return true;
    }
    return transcriptContains(provider, rows(row), row, message.id);
  });
  const receipt = anchor ?? stop;
  const result = receipt ? receiptFor(receipt) : confirmed ?? agyReceipt;
  if (!result) return;
  if (!stop) {
    const abort = observation.tui?.bookPath && [...book(observation).values()].find(entry =>
      entry.receipt?.kind === 'confirmed' && entry.active?.inputId === message.id &&
      entry.active.sessionId === result.sessionId);
    const at = abort?.receipt.at ?? newer?.receivedAt;
    return at == null ? result : { ...result, completion: { ...result, at, noReply: true,
      source: abort ? 'loom-pty confirmed interruption' : 'agy newer root PreInvocation' } };
  }
  const completion = { at: stop.receivedAt, sessionId: session(stop), turnId: stop.turn_id };
  if (canceled(stop) || stop.hook_event_name === 'StopFailure' || stop.error) {
    return { ...result, completion: { ...completion, noReply: true, source: `${provider} native ${stop.hook_event_name}` } };
  }
  let reply;
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
    } else if ((stop === sequentialStop || anchor?.turn_id && stop.turn_id === anchor.turn_id) && stop.last_assistant_message?.trim()) {
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

export function tui(project, call = hc, fixtureSend) {
  async function observe(terminal, provider, sessionId, binding) {
    const events = terminalEvents(project, terminal.address, terminal)
      .filter(row => !row.agent_id && session(row) && (!sessionId || session(row) === sessionId));
    const snapshot = { terminal, events, provider, tui: binding, strictEnd: true };
    if (terminal.state === 'finished') return { ...snapshot, state: 'finished' };
    if (binding?.transport === 'loom-pty') {
      const status = terminal.status?.state;
      let frame;
      try { frame = await controlTui(binding, 'state'); }
      catch (error) {
        return { ...snapshot, state: 'unknown', writeEvidence: {
          transport: 'loom-pty', screen: 'unavailable', hc: status ?? null, reason: error.code ?? 'control-unavailable',
        } };
      }
      const { screen, host, native } = frame;
      const active = frame.phase === 'busy' && native.activeSince !== undefined && {
        pty: true, hcTurn: terminal.turn, since: native.activeSince, sessionId: native.sessionId, turnId: native.activeTurn,
      };
      const veto = ['working', 'blocked', 'error'].includes(status);
      const state = frame.exit ? 'finished' : frame.blocker ?? (frame.ready && !veto ? 'idle' :
        ['blocked', 'error'].includes(status) ? 'blocked' : screen.kind === 'busy' && active ? 'busy' :
          ['idle', 'busy'].includes(screen.kind) ? 'unknown' : screen.kind);
      return { ...snapshot, state, active, generation: host.generation, urgentReady: frame.urgentReady && !veto, writeEvidence: {
        transport: 'loom-pty', screen: screen.kind, native: native.phase ?? 'unknown', hc: status ?? null,
        complete: screen.text !== undefined, humanActive: host.humanActive, composerEmpty: screen.empty,
      } };
    }
    if (binding?.transport === 'plain-hc' || (!fixtureSend && binding)) {
      return { ...snapshot, state: 'blocked',
        writeEvidence: { transport: binding.transport ?? 'legacy-hc', reason: binding.reason ?? 'control-unavailable' } };
    }
    const frame = await call('read', terminal.address, '--lines', '0');
    const visible = terminal.screen !== 'inexact' && frame?.complete === true &&
      frame.how === 'screen' && typeof frame.text === 'string';
    const screen = visible ? adapters.get(provider).screen.classify(frame.text) : 'unknown';
    const native = nativeInputState(provider, events);
    const status = terminal.status?.state;
    let state = screen;
    if (status === 'blocked' || status === 'error') state = 'blocked';
    else if (['idle', 'busy', 'unknown'].includes(screen)) {
      if (screen === 'idle' && native.state === 'idle' && status !== 'working') state = 'idle';
      else if (screen === 'busy' && native.state === 'busy' && !['idle', 'done'].includes(status)) state = 'busy';
      else state = 'unknown';
    }
    const active = native.state === 'busy' ? activeTurn(terminal, native.opened) : undefined;
    const writeEvidence = { screen, native: native.state, hc: status ?? null, complete: visible, proof: native.proof };
    return { ...snapshot, state, active, writeEvidence };
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

  async function send(message, snapshot) {
    if (message.mode === 'steer') throw Object.assign(new Error('TUI steer requires queueing'), { kind: 'steer-unavailable' });
    if (fixtureSend && !snapshot.tui) return fixtureSend(message, snapshot);
    if (!snapshot.tui || snapshot.state !== 'idle' && !(message.urgent && snapshot.urgentReady)) {
      throw Object.assign(new Error('TUI control is unavailable or blocked'), { kind: 'blocked' });
    }
    const result = await controlTui(snapshot.tui, 'submit', {
      id: message.id, text: message.text, generation: snapshot.generation, timeoutMs: 900, urgent: message.urgent,
    }).catch(error => {
      if (error.code === 'INPUT_SIZE') error.kind = 'input-refused';
      throw error;
    });
    if (result.kind !== 'confirmed') {
      const kind = result.kind !== 'refused' || result.code === 'previous-input-unconfirmed' ? 'unconfirmed' :
        ['invalid-input', 'id-conflict'].includes(result.code) ? 'input-refused' :
          result.code === 'human-active' || result.code === 'frame-changed' ? result.code : 'blocked';
      throw Object.assign(new Error(`TUI submit ${result.code ?? result.kind}`), { kind });
    }
    return result;
  }

  return {
    resolve, inspect, send, sameTurn, turnEnd, nativeDelivery, plan: inputPlan,
    async interrupt(message, snapshot) {
      if (!snapshot?.tui?.socket) {
        throw Object.assign(new Error('TUI does not support guarded interruption'), { kind: 'input-refused' });
      }
      if (!sameTurn(message.active, snapshot.active)) {
        throw Object.assign(new Error('TUI turn changed before interruption'), { kind: 'blocked' });
      }
      const { since, turnId, sessionId } = message.active;
      const result = await controlTui(snapshot.tui, 'interrupt', {
        id: message.id, generation: snapshot.generation, turnAt: since, sessionId, turnId,
      });
      if (result.kind !== 'confirmed') {
        throw Object.assign(new Error(`TUI interrupt ${result.code ?? result.kind}`), {
          kind: result.kind === 'refused' ? 'blocked' : 'unconfirmed',
        });
      }
    },
  };
}
