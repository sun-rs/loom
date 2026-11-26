import { codexPrompt } from '../adapters/prompt-state.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, constants } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { deliveryId, messageIdPattern, wireText } from '../inbox/message.mjs';
import { holderError } from '../holder/protocol.mjs';
import { eventPath, jsonRows, prepareJournal, writeState } from './io.mjs';
import { readJSON } from './host-control.mjs';
import { headAt, finishHead } from './turn-heads.mjs';
import { codexFailure, codexRefusal } from './codex-pipe-errors.mjs';
import { advancePipeWrite, correlate, offlinePipeJournal, pipeCursor, queueCall, queueFrame,
  replayPipe, verifyPipeWatermark } from './codex-pipe-rpc.mjs';

const actions = { prompt: 'turn/start', steer: 'turn/steer', abort: 'turn/interrupt' };
const statuses = new Set(['completed', 'failed', 'interrupted']);
const refusal = (message, kind = 'uncertain') => Object.assign(new Error(message), { kind });
const pause = 35;
const overloadRetries = 5;
const writeRetries = 64;
const cleanupMethod = 'thread/backgroundTerminals/terminate';
const nativeRefusals = new Map([
  ['item/commandExecution/requestApproval', { decision: 'decline' }],
  ['item/fileChange/requestApproval', { decision: 'decline' }],
  ['item/permissions/requestApproval', { permissions: {} }],
  ['item/tool/requestUserInput', { answers: {} }],
  ['item/tool/call', { contentItems: [{ type: 'inputText', text: 'Loom has no handler for this tool' }], success: false }],
  ['mcpServer/elicitation/request', { action: 'decline' }],
  ['applyPatchApproval', { decision: 'denied' }],
  ['execCommandApproval', { decision: 'denied' }],
]);

export function codexPipeSession(project, row, dir, incarnation, client, verify, dead, {
  now = Date.now, requestTimeoutMs = 120_000, controlWaitMs = 3_000, stopGraceMs = 2_000,
} = {}) {
  const checkpoint = join(dir, 'rpc.json');
  const path = eventPath(project, row.addr);
  const rows = jsonRows(prepareJournal(path));
  const have = new Set(rows.map(event => event.eventId));
  const state = readJSON(checkpoint) ?? {
    version: 1, incarnation, streamId: randomUUID(), rpc: pipeCursor(), requests: {}, outbox: [],
    stage: 'new', number: rows.reduce((max, event) => Math.max(max, event.turn ?? 0), 0), seq: 0,
  };
  if (state.version !== 1 || state.incarnation !== incarnation ||
      row.sessionId && state.threadId && row.sessionId !== state.threadId) throw holderError('HOLDER_IDENTITY');

  let broken;
  let lastSnapshot;
  let inSerial = Promise.resolve();
  const serialize = action => {
    const result = inSerial.then(action);
    inSerial = result.catch(() => {});
    return result;
  };

  function save() {
    try { writeState(checkpoint, JSON.stringify(state)); }
    catch (error) { broken = error; throw error; }
  }

  function publish() {
    if (!state.outbox.length) return;
    try {
      for (const event of state.outbox) {
        if (have.has(event.eventId)) continue;
        appendFileSync(path, JSON.stringify(event) + '\n', { mode: 0o600, flush: true,
          flag: constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW });
        have.add(event.eventId);
        rows.push(event);
      }
      state.outbox = [];
      save();
    } catch (error) { broken = error; throw error; }
  }

  function add(type, fields = {}) {
    const seq = ++state.seq;
    const at = now();
    state.lastEventAt = at;
    state.outbox.push({ eventId: `${row.addr}:${state.streamId}:${seq}`, addr: row.addr, cwd: row.cwd, version: 1,
      incarnation, streamId: state.streamId, sessionId: state.threadId, seq, type, at, ...fields });
  }

  function issue(method, params, meta, prior) {
    const deadlineAt = prior?.deadlineAt ?? now() + requestTimeoutMs;
    const retries = prior ? prior.retries + 1 : 0;
    const call = queueCall(state.rpc, method, params, meta, { deadlineAt, retries });
    Object.assign(state.rpc.outgoing.at(-1), { deadlineAt, ...(retries && { notBefore: now() + 50 * 2 ** retries }) });
    return call;
  }

  const turnFields = () => {
    const { turn, turnId, sinceSeq } = state.active;
    return { turn, turnId, sinceSeq };
  };

  function startTurn(turnId) {
    if (typeof turnId !== 'string' || !turnId || state.lastTurn === turnId) return;
    if (state.active) {
      if (state.active.turnId !== turnId) throw holderError('CODEX_TURN', 'Codex reported overlapping root turns');
      return;
    }
    state.active = { turnId, turn: ++state.number, sinceSeq: state.seq + 1, since: now(),
      start: state.pendingPrompt?.start ?? headAt(row.cwd), inputIds: [], messages: {} };
    add('turn-start', { ...turnFields(), ...state.active.start });
    state.pendingPrompt = undefined;
  }

  function endTurn(outcome, source = 'Codex app-server turn/completed') {
    const active = state.active;
    if (!active) return;
    const reason = outcome.failure === 'rate_limited' || outcome.failure === 'quota' ? 'rate-limit' :
      outcome.failure === 'auth' ? 'auth' : undefined;
    if (reason && reason !== state.failure) add('stuck', { reason, turn: active.turn });
    if (!reason && state.failure) add('recovered', { reason: state.failure, turn: active.turn });
    state.failure = reason;
    const message = Object.values(active.messages).findLast(item => item.phase === 'final_answer') ??
      Object.values(active.messages).findLast(item => !item.phase);
    add('turn-end', { ...turnFields(), nativeTurnId: active.turnId, outcome, source, inputIds: active.inputIds,
      ...finishHead(project, row, active.start), finalReply: outcome.kind === 'completed' ? message?.text?.trim() || null : null,
      ...(outcome.kind === 'aborted' && { interruptedBy: active.interruptedBy ?? null }) });
    if (outcome.kind === 'aborted') {
      for (const processId of active.backgroundProcesses ?? []) {
        issue(cleanupMethod, { threadId: state.threadId, processId }, { turnId: active.turnId });
      }
    }
    state.lastTurn = active.turnId;
    state.active = state.pendingPrompt = undefined;
  }

  function input(item) {
    const id = deliveryId(item.content?.filter(p => p.type === 'text').map(p => p.text).join('\n'));
    if (!messageIdPattern.test(id ?? '') || state.active.inputIds.includes(id)) return;
    state.active.inputIds.push(id);
    add('input-received', { ...turnFields(), inputId: id });
    for (const action of ['prompt', 'steer']) {
      const request = state.requests[`${action}:${id}`];
      if (request?.status === 'pending') request.status = 'accepted';
    }
  }

  function notification(method, p) {
    if (!state.threadId || p.threadId !== state.threadId) return;
    const turn = p.turn;
    if (method === 'turn/started') startTurn(turn?.id);
    if (method === 'turn/completed' && statuses.has(turn?.status) && turn.id === state.active?.turnId) {
      for (const item of turn.items ?? []) if (item.type === 'userMessage') input(item);
      endTurn(turn.status === 'completed' ? { kind: 'completed' } : turn.status === 'interrupted' ?
        { kind: 'aborted' } : codexFailure('Codex reported a failed turn', turn.error));
      return;
    }
    if (p.turnId !== state.active?.turnId || !state.active) return;
    const item = p.item;
    if (method === 'item/started' || method === 'item/completed') {
      if (item?.type === 'userMessage') input(item);
      else if (item?.type === 'agentMessage') {
        const messages = state.active.messages;
        const previous = Object.hasOwn(messages, item.id) ? messages[item.id] : {};
        Object.defineProperty(messages, item.id, { enumerable: true, configurable: true, writable: true,
          value: { phase: item.phase ?? previous.phase, text: item.text || previous.text || '' } });
      } else if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall'].includes(item?.type)) {
        if (method === 'item/started' && item.type === 'commandExecution' && typeof item.processId === 'string' && item.processId) {
          const processes = state.active.backgroundProcesses ??= [];
          if (!processes.includes(item.processId)) processes.push(item.processId);
        }
        add(method === 'item/started' ? 'tool_call_started' : 'tool_call_ended', { ...turnFields(),
          callId: item.id, tool: item.name ?? item.tool ?? item.type, input: item.command ?? item.arguments, exitCode: item.exitCode,
          status: item.status });
      }
    } else if (method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
      if (p.delta && !state.active.progress) {
        add('model-progress', turnFields());
        state.active.progress = true;
      }
      const messages = state.active.messages;
      if (!Object.hasOwn(messages, p.itemId)) Object.defineProperty(messages, p.itemId, {
        enumerable: true, configurable: true, writable: true, value: { text: '' },
      });
      messages[p.itemId].text += p.delta;
    } else if (method === 'thread/tokenUsage/updated' && p.tokenUsage?.last) {
      const { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens } = p.tokenUsage.last;
      add('usage', { ...turnFields(), usage: { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens,
        context: { tokens: p.tokenUsage.last.totalTokens, contextWindow: p.tokenUsage.modelContextWindow } } });
    }
  }

  function receive(frame) {
    if (typeof frame.method === 'string') {
      if (Object.hasOwn(frame, 'id')) {
        // This adapter opens threads with approvalPolicy=never. Unsupported
        // requests get a protocol-specific refusal and cannot block the stream.
        const result = nativeRefusals.get(frame.method);
        queueFrame(state.rpc, { id: frame.id, ...(result ? { result } :
          { error: { code: -32601, message: 'Unsupported Loom client request' } }) });
        const prompt = codexPrompt(frame.method, frame.params);
        if (prompt && (!frame.params?.threadId || frame.params.threadId === state.threadId)) {
          state.rpc.outgoing.at(-1).userPrompt = { ...prompt, since: now(), cli: 'codex', source: 'native' };
        }
      } else notification(frame.method, frame.params ?? {});
      return;
    }
    const call = correlate(state.rpc, frame);
    if (!call) return;
    const { method, meta } = call;
    const result = frame.result;
    const kind = frame.error && codexRefusal(method, frame.error);
    const request = meta?.key && state.requests[meta.key];
    const activeGuard = method === 'turn/steer' || method === 'turn/interrupt';
    if (kind === 'provider-overloaded' && method !== cleanupMethod && request?.status !== 'accepted' &&
        (!activeGuard || state.active?.turnId === meta.turnId) &&
        call.params && call.retries < overloadRetries && now() < call.deadlineAt) {
      const next = issue(method, call.params, meta, call);
      if (request) request.result.requestId = String(next.id);
      return;
    }
    if (method === cleanupMethod) {
      if (frame.error) add('background-terminal-cleanup-failed', { turnId: meta.turnId, processId: call.params.processId });
      return;
    }
    if (method === 'initialize') {
      if (!result || frame.error) state.fault = { reason: 'Codex refused initialization', kind };
      else {
        state.initializeDone = true;
        state.stage = 'initialized';
      }
    } else if (method === 'thread/start' || method === 'thread/resume') {
      const thread = result?.thread;
      if (frame.error || typeof thread?.id !== 'string' || !thread.id || meta?.resume && thread.id !== meta.resume) {
        state.fault = { reason: 'Codex refused or changed the native thread', kind };
      } else {
        state.threadId = thread.id;
        state.transcriptPath = typeof thread.path === 'string' ? thread.path : undefined;
        state.model = result.model ?? row.model;
        state.effort = result.reasoningEffort ?? row.effort;
        if (row.model && state.model !== row.model || row.effort && state.effort !== row.effort) {
          state.fault = 'Codex thread model or effort differs from the requested profile';
        }
        state.stage = 'ready';
        add('stream-opened');
      }
    } else if (meta?.key) {
      if (!request) throw holderError('CODEX_CORRELATION');
      if (frame.error || method === 'turn/start' && !result?.turn?.id) {
        // Native rejection never releases an already-confirmed user item.
        if (request.status !== 'accepted') {
          request.status = kind ? 'refused' : 'uncertain';
          if (kind) request.kind = kind;
          if (method === 'turn/start') state.pendingPrompt = undefined;
        }
      } else {
        request.status = 'accepted';
        if (method === 'turn/start') startTurn(result.turn.id);
        if (method === 'turn/interrupt' && state.active?.turnId === meta.turnId) state.active.interruptedBy = 'loom';
      }
    }
  }

  function failUnconfirmed(kind) {
    for (const [key, request] of Object.entries(state.requests)) {
      if (!['pending', 'uncertain'].includes(request.status)) continue;
      request.status = 'refused';
      request.kind = kind;
      const [action, inputId] = key.split(':');
      add('input-failed', { inputId, action, reason: kind });
    }
  }

  function ended(code, signal, missing = false) {
    if (state.endedAt) return;
    state.endedAt = now();
    failUnconfirmed(state.retired ?? 'runtime-exited');
    if (state.active) endTurn({ kind: 'failed', failure: state.retired ?? 'runtime_exited' }, 'Codex holder exit');
    state.pendingPrompt = undefined;
    state.rpc.calls = {};
    state.rpc.outgoing = [];
    if (state.threadId) add('exited', { code, signal, ...(state.retired && { reason: state.retired }),
      ...(missing && !state.retired && { reason: 'holder lost' }) });
  }

  function consume(batch) {
    if (!batch.length) return;
    try {
      replayPipe(state.rpc, batch, receive, ended);
      save();
      publish();
    } catch (error) { broken = error; throw error; }
  }

  async function read() {
    if (broken) throw broken;
    publish();
    if (state.endedAt) return;
    let snapshot;
    try { snapshot = await client.snapshot(); }
    catch (error) {
      if (!await dead(error)) throw error;
      for (const batch of offlinePipeJournal(dir, state.rpc.seq)) consume(batch);
      if (!state.endedAt) { ended(null, null, true); save(); publish(); }
      return;
    }
    verify(snapshot);
    if (snapshot.gap || BigInt(state.rpc.seq) > snapshot.eventSeq) throw holderError('HOLDER_GAP');
    while (BigInt(state.rpc.seq) < snapshot.eventSeq) {
      const batch = (await client.read(BigInt(state.rpc.seq))).filter(event => event.seq <= snapshot.eventSeq);
      if (!batch.length) throw holderError('HOLDER_GAP');
      consume(batch);
    }
    verifyPipeWatermark(state.rpc, snapshot);
    lastSnapshot = snapshot;
  }

  function prepareHandshake() {
    let changed = true;
    if (state.stage === 'new') {
      issue('initialize', { clientInfo: { name: 'loom', version: '0' }, capabilities: { experimentalApi: true } });
      state.stage = 'initializing';
    } else if (state.stage === 'initialized') {
      queueFrame(state.rpc, { method: 'initialized', params: {} }, 'initialized');
      state.rpc.outgoing.at(-1).deadlineAt = now() + requestTimeoutMs;
      state.stage = 'notifying';
    } else if (state.stage === 'notified') {
      const resume = row.sessionId;
      issue(resume ? 'thread/resume' : 'thread/start', {
        cwd: row.cwd, model: row.model, approvalPolicy: 'never',
        ...(resume ? { threadId: resume, excludeTurns: true } :
          { experimentalRawEvents: true, config: { model_reasoning_effort: row.effort } }),
      }, { resume });
      state.stage = 'opening';
    } else changed = false;
    if (changed) save();
  }

  function requestExpired() {
    let updated = false;
    for (const call of Object.values(state.rpc.calls)) {
      const request = call.meta?.key && state.requests[call.meta.key];
      if (call.deadlineAt === undefined) {
        // Older checkpoints can be resumed with the same request ID.
        call.deadlineAt = (request?.at ?? now()) + requestTimeoutMs;
        updated = true;
      }
      if (call.deadlineAt > now()) continue;
      if (request?.status !== 'accepted') return true;
      delete state.rpc.calls[call.id];
      state.rpc.outgoing = state.rpc.outgoing.filter(frame => frame.requestId !== call.id);
      updated = true;
    }
    for (const frame of state.rpc.outgoing) {
      if (frame.deadlineAt === undefined) {
        frame.deadlineAt = state.rpc.calls[frame.requestId]?.deadlineAt ?? now() + requestTimeoutMs;
        updated = true;
      }
      if (frame.deadlineAt <= now()) return true;
    }
    if (updated) save();
    return false;
  }

  async function stopProcess() {
    for (const signal of ['SIGTERM', 'SIGKILL']) {
      if (state.endedAt) return;
      const closing = state.closing ??= {};
      if (closing[signal] === undefined) {
        await client.signal(signal).catch(error => { if (error.code !== 'HOLDER_EXITED') throw error; });
        closing[signal] = now();
        save();
      }
      const until = performance.now() + Math.max(0, closing[signal] + stopGraceMs - now());
      do {
        await read();
        if (state.endedAt || performance.now() >= until) break;
        await delay(pause);
      } while (true);
    }
    if (!state.endedAt) throw holderError('CODEX_RPC', 'Codex exit was not confirmed after SIGKILL');
  }

  async function retire(kind) {
    if (!state.retired) {
      state.retired = kind;
      failUnconfirmed(kind);
      state.rpc.calls = {};
      state.rpc.outgoing = [];
      save();
      publish();
    }
    await stopProcess();
  }

  async function step() {
    await read();
    if (state.endedAt) return;
    if (state.retired || state.fault) return retire(state.retired ?? (state.fault.kind || 'runtime-exited'));
    if (requestExpired()) return retire('request-timeout');
    prepareHandshake();
    const frame = state.rpc.outgoing[0];
    if (!frame || frame.notBefore > now()) return;
    const call = state.rpc.calls[frame.requestId];
    const request = call?.meta?.key && state.requests[call.meta.key];
    if (call?.retries && request) {
      const guarded = call.method === 'turn/steer' || call.method === 'turn/interrupt';
      if (request.status === 'accepted' || guarded && state.active?.turnId !== call.meta.turnId) {
        if (frame.offset) return retire('runtime-exited');
        state.rpc.outgoing.shift();
        delete state.rpc.calls[call.id];
        if (request.status !== 'accepted') {
          request.status = 'refused';
          request.kind = call.method === 'turn/steer' ? 'steer-unavailable' : 'status_mismatch';
        }
        save();
        return 'progress';
      }
    }
    if (frame.zeroWrites >= writeRetries) return retire('retry-exhausted');
    const result = await advancePipeWrite(state.rpc, client, lastSnapshot, tag => {
      if (tag === 'initialized') state.stage = 'notified';
      save();
    });
    if (['stale', 'would-block'].includes(result)) {
      frame.zeroWrites = (frame.zeroWrites ?? 0) + 1;
      save();
    }
    return result;
  }

  async function until(predicate, timeout) {
    const limit = performance.now() + timeout;
    do {
      const result = await step();
      if (predicate() || state.endedAt) return;
      if (result !== 'progress') await delay(pause);
    } while (performance.now() < limit);
  }

  async function control(action, { id, text, active }) {
    await step();
    if (!messageIdPattern.test(id) || !Object.hasOwn(actions, action) ||
        action !== 'abort' && (typeof text !== 'string' || !text.trim())) throw refusal('Invalid Codex request', 'input-refused');
    if (action !== 'abort') {
      if (typeof text.toWellFormed !== 'function') throw refusal('Cannot prepare well-formed UTF-16 for Codex', 'input-refused');
      text = text.toWellFormed();
    }
    const key = `${action}:${id}`;
    const digest = createHash('sha256').update(JSON.stringify([text, active?.streamId, active?.sinceSeq, active?.turnId])).digest('hex');
    let request = state.requests[key];
    if (request && request.digest !== digest) throw refusal('Codex request ID conflicts with prior request', 'input-refused');
    if (!request) {
      const current = state.active;
      if (state.endedAt || state.stage !== 'ready' || state.rpc.outgoing.length || (action === 'prompt' ?
        current || state.pendingPrompt : !current || current.sinceSeq !== active?.sinceSeq ||
          current.turnId !== active?.turnId || state.streamId !== active?.streamId)) {
        throw refusal('Codex turn changed', action === 'steer' ? 'steer-unavailable' : 'status_mismatch');
      }
      const input = action === 'abort' ? {} : {
        input: [{ type: 'text', text: wireText(id, text), text_elements: [] }], clientUserMessageId: id,
      };
      const call = issue(actions[action], { threadId: state.threadId, ...input,
        ...(action === 'abort' ? { turnId: current.turnId } : action === 'steer' ? { expectedTurnId: current.turnId } : {}),
      }, { key, turnId: current?.turnId });
      request = state.requests[key] = { digest, status: 'pending', at: now(), deadlineAt: call.deadlineAt, streamId: state.streamId,
        result: { kind: 'accepted', requestId: String(call.id), seq: state.seq + 1 } };
      if (action === 'prompt') state.pendingPrompt = { key, start: headAt(row.cwd) };
      save();
    }
    if (request.status === 'pending') await until(() => request.status !== 'pending', controlWaitMs);
    if (request.status === 'accepted') return request.result;
    if (request.status === 'pending') return { kind: 'pending', deadlineAt: request.deadlineAt ?? request.at + requestTimeoutMs };
    if (request.status === 'refused') throw refusal('Codex refused the request', request.kind);
    throw refusal('Codex request awaits native evidence');
  }

  return {
    hosted: true, protocol: 3, incarnation, streamId: state.streamId, rows,
    ready: () => serialize(async () => {
      await until(() => state.stage === 'ready' && !state.fault, requestTimeoutMs);
      if (state.fault) {
        const error = holderError(state.fault.kind === 'in_use' ? 'in-use' : 'CODEX_RPC', state.fault.reason ?? state.fault);
        if (state.fault.kind) error.kind = state.fault.kind;
        throw error;
      }
      if (state.retired && !state.threadId) throw holderError(state.retired, 'Codex app-server retired before thread startup');
      if (!state.threadId && !state.endedAt) {
        await retire('request-timeout');
        throw holderError('CODEX_RPC', 'Codex native thread did not become ready');
      }
    }),
    pull: () => serialize(step),
    get session() { return { id: state.threadId,
      status: () => ({ value: { kind: state.active || state.pendingPrompt ? 'running' : 'idle',
        sinceSeq: state.active?.sinceSeq, lastEventAt: state.lastEventAt, released: Boolean(state.endedAt) } }),
      model: () => ({ value: state.model }), effort: () => ({ value: state.effort }), steer: true }; },
    get sessionId() { return state.threadId; },
    get endedAt() { return state.endedAt; },
    get transcriptPath() { return state.transcriptPath; },
    active: () => state.active,
    userPrompt: () => state.rpc.outgoing.find(frame => frame.userPrompt)?.userPrompt,
    error: () => broken ?? state.fault,
    receipt: (action, id) => {
      const request = state.requests[`${action}:${id}`];
      if (request?.status === 'pending' && request.deadlineAt === undefined) {
        return { ...request, deadlineAt: request.at + requestTimeoutMs };
      }
      return request ?? { status: 'absent' };
    },
    control: (action, message) => serialize(() => control(action, message)),
    close: () => serialize(async () => {
      await read();
      await stopProcess();
      return { endedAt: state.endedAt };
    }),
  };
}
