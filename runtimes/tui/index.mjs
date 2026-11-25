import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRuntimeRegistry, defaultRuntimes, defineRuntime, UnsupportedOptionError } from '@botiverse/oar';
import { createSessionKernel, inputImagesRefusal, sealSession, withdrawHeld } from '@botiverse/oar/kernel';
import { parseTuiVersion } from '../../adapters/tui-version.mjs';
import { nativeClaude } from '../../daemon/executables.mjs';
import { hookObservation, providers } from '../../tui/providers.mjs';
import { messageIdPattern, wireText } from '../../inbox/message.mjs';
import { exec } from './hc.mjs';
import { screenEvidence } from './failure.mjs';
import { TurnTracker } from './projection.mjs';
import { jsonlTail } from './read-jsonl.mjs';
import { absoluteCommand, openNativeTui } from './transport.mjs';

const brands = { claude: 'Claude Code', codex: 'Codex', agy: 'Antigravity' };
const capabilities = { steer: 'none', queue: { durable: false }, attribution: 'opaque', images: false };
const unsupported = 'The TUI runtime uses per-launch settings and a guarded text composer';
const refusedSessionOptions = Object.fromEntries([
  'env', 'launchArgs', 'userConfiguration', 'mcpServers', 'systemPrompt', 'appendSystemPrompt',
  'disallowedTools', 'additionalDirectories', 'serviceTier', 'outputSchema', 'name', 'goals',
  'fork', 'nativeMemoryDefault', 'sessionLogUpload', 'modelRequests', 'endTurnProcessesOnAbort',
].map(key => [key, unsupported]));
const reject = (code, reason) => ({ kind: 'rejected', code, reason });

function validateOptions(cli, options) {
  for (const [key, reason] of Object.entries(refusedSessionOptions)) {
    const value = options[key];
    if (value == null || value === false || Array.isArray(value) && !value.length ||
        key === 'env' && !Object.keys(value).length || key === 'userConfiguration' && !value.exclude?.length) continue;
    throw new UnsupportedOptionError(key, reason);
  }
  if (options.resume !== undefined && !messageIdPattern.test(options.resume)) {
    throw new UnsupportedOptionError('resume', 'This TUI invocation does not support that native resume identity');
  }
  if (options.retainedBytes !== undefined && (!Number.isSafeInteger(options.retainedBytes) || options.retainedBytes <= 0)) {
    throw new UnsupportedOptionError('retainedBytes', 'retainedBytes must be a positive integer');
  }
}

export function createTuiRuntime(cli, { command, hcCommand = 'hc', stateDir, open = openNativeTui, pollIntervalMs = 200 } = {}) {
  if (!Object.hasOwn(brands, cli)) throw new RangeError(`Unsupported OAR TUI: ${cli}`);
  const nativeCommand = () => command ?? (cli === 'claude' ? nativeClaude() : cli);
  return defineRuntime({
    id: `${cli}-tui`, brand: { name: `${brands[cli]} TUI`, icon: null }, capabilities, refusedSessionOptions,
    manualCompaction: { kind: 'unsupported', reason: 'No TUI compaction control' },
    sessionCapabilities: () => ({
      steer: false, images: false, taskEventTypes: [], stopTask: false, fileChanges: false, sideQuestion: false,
      mcpTransports: [], nativeSessionFile: true, contextUsage: { tokens: false, contextWindow: false },
      compactionEvents: { started: false, ended: false },
    }),
    async installation() {
      if (!['darwin', 'linux'].includes(process.platform)) {
        return { kind: 'unsupported', code: 'unsupported_platform', reason: 'Local hc requires macOS or Linux' };
      }
      try {
        const path = await absoluteCommand(nativeCommand(), cli);
        const opts = { timeout: 5_000, maxBuffer: 64 * 1024 };
        const [hc, native] = await Promise.all([exec(hcCommand, ['--version'], opts), exec(path, ['--version'], opts)]);
        const version = parseTuiVersion(cli, native.stdout);
        if (version && /^hc\s+\d+\.\d+\.\d+/m.test(hc.stdout)) {
          return { kind: 'available', via: 'executable', command: path, version };
        }
        return { kind: 'unsupported', code: 'unrecognized_executable', reason: `Expected ${brands[cli]} and hc` };
      } catch (error) {
        return error.code === 'ENOENT' ? { kind: 'not_found' } :
          { kind: 'unsupported', code: 'readiness_failed', reason: error.code ?? error.message };
      }
    },
    async session(installation, options, context) {
      validateOptions(cli, options);
      const cwd = await realpath(resolve(options.cwd));
      const host = await open({
        ...options, cli, cwd, command: installation.command ?? nativeCommand(), hcCommand,
        stateDir: resolve(cwd, stateDir ?? '.loom/tui'),
      });
      return bindOarTui(cli, host, cwd, options, context, pollIntervalMs);
    },
  }, { execution: 'process' });
}

export function createTuiRegistry(options = {}) {
  return createRuntimeRegistry([...defaultRuntimes.list(),
    ...Object.keys(brands).map(cli => createTuiRuntime(cli, options[cli]))]);
}

function bindOarTui(cli, host, cwd, options, context, pollIntervalMs) {
  const kernel = createSessionKernel(host.sessionId ?? randomUUID(), undefined, options.retainedBytes);
  kernel.opened(context);
  const tail = jsonlTail();
  const tailTranscript = jsonlTail();
  const provider = providers[cli];
  const tracker = cli === 'claude' && new TurnTracker(kernel);
  const held = [];
  const attempts = new Map();
  let active;
  let nativeSessionId = host.sessionId;
  let nativeFile;
  let serial = Promise.resolve();
  let scheduled;
  const exclusive = action => {
    const result = serial.then(action);
    serial = result.catch(() => {});
    return result;
  };

  async function refresh() {
    const state = await host.readState();
    nativeFile ??= state.native?.transcriptPath;
    const rows = await tail(host.hookSink);
    if (tracker) {
      const screen = screenEvidence(state.screen?.text ?? '');
      const transcript = (await tailTranscript(nativeFile)).map(row => ({
        row, at: Date.parse(row.timestamp) || Date.now(), transcript: true,
      }));
      const hooks = rows.filter(row => row.session_id === nativeSessionId && row.cwd === cwd && !row.agent_id)
        .map(row => ({ row, at: row.receivedAt }));
      for (const item of [...transcript, ...hooks].sort((a, b) => a.at - b.at)) {
        if (item.transcript) tracker.transcript(item.row, item.at);
        else tracker.hook(item.row, screen);
      }
      tracker.screen(screen, Date.now());
    }
    for (const row of tracker ? [] : rows) {
      const observation = hookObservation(provider, row);
      if (!observation?.sessionId || row.cwd !== cwd || nativeSessionId && observation.sessionId !== nativeSessionId) continue;
      nativeSessionId ??= observation.sessionId;
      const events = [];
      const model = row.model ?? row.modelName;
      if (model) events.push({ kind: 'model', model });
      const start = ['UserPromptSubmit', 'PreInvocation'].includes(row.hook_event_name);
      if (start) {
        const attempted = attempts.get(observation.inputId);
        active = { turnId: observation.turnId, inputId: attempted?.inputId ?? observation.inputId };
        events.push({ kind: 'turn_active', ...(active.inputId && { inputId: active.inputId }) });
        const input = row.prompt ?? attempted?.input;
        if (input) events.push({ kind: 'user_message', input, evidence: 'conversation',
          ...(active.inputId && { inputId: active.inputId }) });
      } else if (active && (!active.turnId || !observation.turnId || active.turnId === observation.turnId) &&
          (observation.interrupted || ['Stop', 'StopFailure'].includes(row.hook_event_name) && observation.phase !== 'busy')) {
        const reply = provider.hooks.normalize(row)?.finalReply;
        const outcome = observation.interrupted ? { kind: 'aborted' } : observation.phase === 'error' ?
          { kind: 'failed', failure: 'unknown', reason: 'Native TUI reported a failure' } : { kind: 'completed' };
        if (outcome.kind === 'completed' && reply) events.push({ kind: 'text_delta', text: reply });
        events.push({ kind: 'turn_ended', outcome, ...(active.inputId && { inputId: active.inputId }) });
        active = undefined;
      }
      kernel.frame({ type: `hook/${row.hook_event_name}`, native: row, events },
        { receivedAt: row.receivedAt, spanId: observation.turnId });
    }
    if (state.exit) {
      clearTimeout(scheduled);
      for (const entry of held.splice(0)) {
        kernel.frame({ type: 'adapter/input_dropped', native: null,
          events: [{ kind: 'input_dropped', requestId: entry.requestId, inputId: entry.inputId, reason: 'turn_interrupted' }] });
      }
      kernel.processExited(state.exit.code ?? null, state.exit.reason);
    }
    return state;
  }

  async function submit(request, state) {
    const { body } = request;
    const refusal = inputImagesRefusal(capabilities, body.images);
    if (refusal) return refusal;
    if (host.transport !== 'loom-pty') return reject('runtime_refused', 'Plain hc fallback requires human input');
    const id = body.inputId.toLowerCase();
    if (attempts.has(id)) return reject('runtime_refused', 'Native input is already attempted');
    if (!state.ready || active || tracker?.active) return reject('busy', 'The TUI composer is busy or unavailable');
    const tracked = tracker && tracker.sent({ ...request, body: { ...body, input: wireText(id, body.input) } }, body.inputId);
    attempts.set(id, body);
    let result;
    try { result = await host.submit({ id, text: body.input, generation: state.host.generation }); }
    catch (error) { result = { kind: 'unconfirmed', code: error.code ?? 'control-unavailable' }; }
    if (result.kind === 'refused') {
      attempts.delete(id);
      if (tracked) tracker.refused(tracked);
    }
    await refresh();
    return result.kind === 'confirmed' ? { kind: 'accepted', native: result } :
      { ...reject('runtime_refused', result.code ?? result.kind), native: result };
  }

  const control = (body, decide) => exclusive(() => kernel.control(body, async request => decide(request, await refresh())));
  const session = sealSession({
    id: kernel.sessionId, capabilities, records: kernel.records, rawEvents: kernel.rawEvents, graph: kernel.graph,
    nativeSessionFile: () => Promise.resolve(nativeFile ?? null),
    prompt: (input, opts) => control({ kind: 'prompt', input, ...opts }, submit),
    queue: (input, opts) => control({ kind: 'queue', input, ...opts }, ({ body, id }) => {
      const refusal = inputImagesRefusal(capabilities, body.images);
      if (refusal) return refusal;
      if (host.transport !== 'loom-pty') return reject('runtime_refused', 'Plain hc fallback requires human input');
      if (attempts.has(body.inputId.toLowerCase()) || held.some(entry => entry.inputId === body.inputId)) {
        return reject('runtime_refused', 'Input is already queued or attempted');
      }
      held.push({ ...body, requestId: id });
      return { kind: 'accepted', queued: 'adapter' };
    }),
    withdraw: inputId => control({ kind: 'withdraw', inputId }, () => withdrawHeld(held, inputId)),
    abort: () => control({ kind: 'abort' }, async (request, state) => {
      if (!(active || tracker?.active) || !host.interrupt || state.native?.phase !== 'busy') {
        return reject('no_active_turn', 'No interruptible TUI turn');
      }
      const tracked = tracker && tracker.interruptSent();
      const result = await host.interrupt({ id: request.id, generation: state.host.generation,
        sessionId: state.native.sessionId, turnAt: state.native.activeSince, turnId: state.native.activeTurn });
      await refresh();
      if (tracked && result.kind === 'refused') tracked.abortSent = false;
      if (result.kind !== 'confirmed') return reject('runtime_refused', result.code ?? result.kind);
      if (active && state.native.sessionId === nativeSessionId) {
        kernel.frame({ type: 'native/interrupted', native: result.source, events: [
          { kind: 'turn_ended', outcome: { kind: 'aborted' }, ...(active.inputId && { inputId: active.inputId }) },
        ] });
        active = undefined;
      }
      return { kind: 'accepted', native: result.source };
    }),
    dispose: () => exclusive(() => kernel.dispose(async () => {
      clearTimeout(scheduled);
      const status = await host.close();
      kernel.processExited(status.exit_code ?? null, status.reason);
    })),
  });
  function poll() {
    if (kernel.unreachable()) return;
    scheduled = setTimeout(() => {
      void exclusive(async () => {
        const state = await refresh();
        if (!state.ready || active || tracker?.active || !held.length || kernel.unreachable()) return;
        const entry = held.shift();
        const { response } = await kernel.control({ kind: 'prompt', input: entry.input, inputId: entry.inputId,
          carries: [entry.inputId] }, request => submit(request, state));
        const result = response.body;
        if (result.kind === 'rejected' && !attempts.has(entry.inputId.toLowerCase())) {
          if (result.code === 'busy' || ['frame-changed', 'human-active'].includes(result.reason)) held.unshift(entry);
          else kernel.frame({ type: 'adapter/input_dropped', native: null, events: [
            { kind: 'input_dropped', requestId: entry.requestId, inputId: entry.inputId, reason: 'runtime_refused' },
          ] });
        }
      }).catch(() => {}).finally(poll);
    }, pollIntervalMs);
    scheduled.unref();
  }
  poll();
  return Object.assign(session, { pane: host.id, transport: host.transport, warnings: host.warnings });
}
