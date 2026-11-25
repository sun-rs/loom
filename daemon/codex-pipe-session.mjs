import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, constants } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { deliveryId, messageIdPattern, wireText } from '../inbox/message.mjs';
import { holderError } from '../holder/protocol.mjs';
import { eventPath, jsonRows, prepareJournal, writeState } from './io.mjs';
import { readJSON } from './host-control.mjs';
import { headAt, finishHead } from './turn-heads.mjs';
import { advancePipeWrite, correlate, offlinePipeJournal, pipeCursor, queueCall, queueFrame,
  replayPipe, verifyPipeWatermark } from './codex-pipe-rpc.mjs';

const actions = { prompt: 'turn/start', steer: 'turn/steer', abort: 'turn/interrupt' };
const statuses = new Set(['completed', 'failed', 'interrupted']);
const refusal = (message, kind = 'uncertain') => Object.assign(new Error(message), { kind });
const pause = 35;
const rate = /rate.?limit|quota|usage.?limit/i;
const auth = /unauthorized|authentication|auth.?error/i;
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

export function codexPipeSession(project, row, dir, incarnation, client, verify, dead) {
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
    const at = Date.now();
    state.lastEventAt = at;
    state.outbox.push({ eventId: `${row.addr}:${state.streamId}:${seq}`, addr: row.addr, cwd: row.cwd, version: 1,
      incarnation, streamId: state.streamId, sessionId: state.threadId, seq, type, at, ...fields });
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
    state.active = { turnId, turn: ++state.number, sinceSeq: state.seq + 1, since: Date.now(),
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
      const error = turn.error;
      const failure = JSON.stringify(error?.codexErrorInfo ?? '') + ' ' + (error?.message ?? '');
      endTurn(turn.status === 'completed' ? { kind: 'completed' } : turn.status === 'interrupted' ?
        { kind: 'aborted' } : { kind: 'failed', failure: rate.test(failure) ? 'rate_limited' : auth.test(failure) ? 'auth' : 'error' });
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
        add(method === 'item/started' ? 'tool_call_started' : 'tool_call_ended', { ...turnFields(),
          callId: item.id, tool: item.name ?? item.tool ?? item.type, input: item.command ?? item.arguments, exitCode: item.exitCode });
      }
    } else if (method === 'item/agentMessage/delta' && typeof p.delta === 'string') {
      const messages = state.active.messages;
      if (!Object.hasOwn(messages, p.itemId)) Object.defineProperty(messages, p.itemId, {
        enumerable: true, configurable: true, writable: true, value: { text: '' },
      });
      messages[p.itemId].text += p.delta;
    } else if (method === 'thread/tokenUsage/updated' && p.tokenUsage?.last) {
      const { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens } = p.tokenUsage.last;
      add('usage', { ...turnFields(), usage: { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens } });
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
      } else notification(frame.method, frame.params ?? {});
      return;
    }
    const call = correlate(state.rpc, frame);
    if (!call) return;
    const { method, meta } = call;
    const result = frame.result;
    if (method === 'initialize') {
      if (!result || frame.error) state.fault = 'Codex refused initialization';
      else {
        state.initializeDone = true;
        state.stage = 'initialized';
      }
    } else if (method === 'thread/start' || method === 'thread/resume') {
      const thread = result?.thread;
      if (frame.error || typeof thread?.id !== 'string' || !thread.id || meta?.resume && thread.id !== meta.resume) {
        state.fault = 'Codex refused or changed the native thread';
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
      const request = state.requests[meta.key];
      if (!request) throw holderError('CODEX_CORRELATION');
      if (frame.error || method === 'turn/start' && !result?.turn?.id) {
        // Native rejection never releases an already-confirmed user item.
        if (request.status !== 'accepted') {
          request.status = 'uncertain';
          if (method === 'turn/start') state.pendingPrompt = undefined;
        }
      } else {
        request.status = 'accepted';
        if (method === 'turn/start') startTurn(result.turn.id);
        if (method === 'turn/interrupt' && state.active?.turnId === meta.turnId) state.active.interruptedBy = 'loom';
      }
    }
  }

  function ended(code, signal, missing = false) {
    if (state.endedAt) return;
    state.endedAt = Date.now();
    if (state.active) endTurn({ kind: 'failed', failure: 'runtime_exited' }, 'Codex holder exit');
    if (state.threadId) add('exited', { code, signal, ...(missing && { reason: 'holder lost' }) });
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
      queueCall(state.rpc, 'initialize', { clientInfo: { name: 'loom', version: '0' }, capabilities: { experimentalApi: true } });
      state.stage = 'initializing';
    } else if (state.stage === 'initialized') {
      queueFrame(state.rpc, { method: 'initialized', params: {} }, 'initialized');
      state.stage = 'notifying';
    } else if (state.stage === 'notified') {
      const resume = row.sessionId;
      queueCall(state.rpc, resume ? 'thread/resume' : 'thread/start', {
        cwd: row.cwd, model: row.model, approvalPolicy: 'never',
        ...(resume ? { threadId: resume, excludeTurns: true } :
          { experimentalRawEvents: true, config: { model_reasoning_effort: row.effort } }),
      }, { resume });
      state.stage = 'opening';
    } else changed = false;
    if (changed) save();
  }

  async function step() {
    await read();
    if (state.fault) throw holderError('CODEX_RPC', state.fault);
    if (state.endedAt) return;
    prepareHandshake();
    return advancePipeWrite(state.rpc, client, lastSnapshot, tag => {
      if (tag === 'initialized') state.stage = 'notified';
      save();
    });
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
      const call = queueCall(state.rpc, actions[action], { threadId: state.threadId, ...input,
        ...(action === 'abort' ? { turnId: current.turnId } : action === 'steer' ? { expectedTurnId: current.turnId } : {}),
      }, { key, turnId: current?.turnId });
      request = state.requests[key] = { digest, status: 'pending', at: Date.now(), streamId: state.streamId,
        result: { kind: 'accepted', requestId: String(call.id), seq: state.seq + 1 } };
      if (action === 'prompt') state.pendingPrompt = { key, start: headAt(row.cwd) };
      save();
    }
    if (request.status === 'pending') await until(() => request.status !== 'pending', 3000);
    if (request.status === 'accepted') return request.result;
    throw refusal('Codex request awaits native evidence');
  }

  return {
    hosted: true, protocol: 3, incarnation, streamId: state.streamId, rows,
    ready: () => serialize(async () => {
      await until(() => state.stage === 'ready', 20_000);
      if (!state.threadId && !state.endedAt) throw holderError('CODEX_RPC', 'Codex native thread did not become ready');
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
    error: () => broken ?? state.fault,
    receipt: (action, id) => state.requests[`${action}:${id}`] ?? { status: 'absent' },
    control: (action, message) => serialize(() => control(action, message)),
    close: () => serialize(async () => {
      await read();
      if (!state.endedAt) {
        await client.signal('SIGTERM').catch(error => { if (error.code !== 'HOLDER_EXITED') throw error; });
        const limit = performance.now() + 5000;
        do { await delay(pause); await read(); }
        while (!state.endedAt && performance.now() < limit);
        if (!state.endedAt) throw holderError('CODEX_RPC', 'Codex exit was not confirmed');
      }
      return { endedAt: state.endedAt };
    }),
  };
}
