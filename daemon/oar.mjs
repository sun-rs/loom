import { accountTime, parseClaudeRateLimitEvent } from '../adapters/accounts/passive.mjs';
import { approval, choice, codexPrompt, promptDetails } from '../adapters/prompt-state.mjs';
import { appendFileSync, constants, lstatSync, realpathSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { appRequestKind, antigravityRuntime, claudeRuntime, codexRuntime, createRuntimeRegistry, opencodeRuntime } from '@botiverse/oar';
import agy from '../adapters/agy/index.mjs';
import { preflightAgyAcp } from '../adapters/agy/acp.mjs';
import { stageAgyHooks } from '../adapters/agy/launch.mjs';
import claude from '../adapters/claude/index.mjs';
import codex from '../adapters/codex/index.mjs';
import { openCodeQuestionDeny, promptObserver } from '../adapters/opencode/index.mjs';
import { deliveryId, wireText } from '../inbox/message.mjs';
import { eventPath, jsonRows, prepareJournal } from './io.mjs';
import { nativeClaude, nativeWorkerExecutable, resolveClaudeExecutable, resolveNativeExecutable, workerBinaryKeys } from './executables.mjs';
import { recordWorkerExecutable } from './worker-executables.mjs';
import { hostWorkerEnvironment, hostWriteBoundary } from './host-worker.mjs';
import { captureOarTurnEnd, headAt } from './turn-heads.mjs';
import { codexConfiguration } from './codex-launch.mjs';
import { codexRefusal } from './codex-pipe-errors.mjs';
import { claudeMemoryArgs, codexDeveloperArgs, memoryLaunch } from '../memory/launch-config.mjs';
import { claudeApiEnvKeys, claudeNetworkEnvKeys } from '../adapters/claude/launch.mjs';
import { allowNativeQuestions, claudeAuthMode } from '../cli/policy.mjs';
import { managedEnvironment } from './release.mjs';
import { seniorToolEnvironment } from './senior-tools.mjs';
import { integrationPs } from './integration-processes.mjs';
import { sandboxNativeWorker, workerEnvironment, workerNativeLogin,
  workerProviderEnvironment } from './worker-environment.mjs';

const registry = createRuntimeRegistry([codexRuntime, antigravityRuntime, opencodeRuntime, claudeRuntime]);
const adapters = { codex, agy, claude };
const rateFailure = new Set(['rate_limited', 'quota']);
const acpProviders = new Set(['agy', 'opencode']);
const activeEvents = new Set(['turn_active', 'user_message', 'text_delta', 'reasoning', 'tool_call_started', 'turn_ended']);
const installationVersions = new WeakMap();
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

export async function openOar(row, project, resume, beforeLaunch) {
  const runtime = registry.require(row.runtimeId);
  const executable = row.cli === 'claude' ? nativeClaude() : row.role === 'worker' ? nativeWorkerExecutable(row.cli) : undefined;
  const managed = managedEnvironment(project, row.addr);
  const host = Boolean(row.hostGrant);
  const isolated = host ? hostWorkerEnvironment(project, row) : workerEnvironment(row);
  const login = host ? undefined : workerNativeLogin(row);
  const guard = seniorToolEnvironment(project, row);
  const env = { HC_TERMINAL_ID: null, LOOM_SENIOR_TOOL_LOG: null, LOOM_SENIOR_TOOL_PROJECT: null,
    ...managed, ...isolated, ...workerProviderEnvironment(row), ...login, ...guard,
    ...(executable && { [workerBinaryKeys[row.cli]]: executable }) };
  let launchArgs;
  let agyWorkspace;
  let integration;
  const questions = allowNativeQuestions(project, row.role);
  if (row.cli === 'opencode' && (host || !questions || guard.LOOM_SENIOR_TOOL_LOG)) {
    const existing = JSON.parse(env.OPENCODE_CONFIG_CONTENT ?? process.env.OPENCODE_CONFIG_CONTENT ?? '{}');
    const permissions = Array.isArray(existing.permissions) ? existing.permissions : [];
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ ...existing,
      ...(!questions && { permissions: [...permissions, openCodeQuestionDeny] }),
      ...(host || guard.LOOM_SENIOR_TOOL_LOG ? { plugins: [...new Set([...(existing.plugins ?? []), promptObserver])] } : {}),
    });
  }
  if (row.cli === 'codex') {
    launchArgs = codexConfiguration(project, row, managed, isolated);
  } else if (row.cli === 'agy') {
    Object.assign(env, { AGY_CLI_DISABLE_AUTO_UPDATE: 'true', GEMINI_HOME: host ? process.env.GEMINI_HOME ?? null : login?.GEMINI_HOME ?? null });
    // The macOS worker already inherits Seatbelt. agy's inner sandbox tries
    // to generate profiles in the real login home before running a command.
    launchArgs = [host || login ? '--sandbox=false' : '--sandbox', '--log-file', host || login ? join(isolated.TMPDIR, 'agy.log') :
      eventPath(project, row.addr).replace(/\.jsonl$/, '.agy.log')];
  } else if (row.cli === 'claude') {
    Object.assign(env, { OAR_CLAUDE_BIN: executable ?? nativeClaude(), CLAUDE_CODE_ENTRYPOINT: 'loom', DISABLE_AUTOUPDATER: '1' });
    // Even an explicit ~/.claude selects a separate Keychain namespace. The
    // resolved directory in isolated still supplies the host write boundary.
    if (host) env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR ?? null;
    if (row.authMode === 'subscription' || claudeAuthMode(project, row.role) !== 'api-key') {
      for (const key of claudeApiEnvKeys) env[key] = null;
    }
    for (const key of claudeNetworkEnvKeys) delete env[key];
    if (host || login) env.CLAUDE_CODE_TMPDIR = isolated.TMPDIR;
    const { env: memoryEnv, claudeSettings } = memoryLaunch(row.cli, { ...row.memory,
      claudeSettings: row.fast === undefined ? {} : { fastMode: Boolean(row.fast) } });
    Object.assign(env, memoryEnv);
    for (const key of claudeNetworkEnvKeys) delete env[key];
    launchArgs = [...claudeMemoryArgs(), ...(Object.keys(claudeSettings).length ? ['--settings', JSON.stringify(claudeSettings)] : [])];
  }
  const probe = login ? { ...env, ...isolated, CLAUDE_CONFIG_DIR: null, GEMINI_HOME: null, ANTIGRAVITY_APP_DATA_DIR: null } : env;
  try {
    if (row.cli === 'agy' && (host || guard.LOOM_SENIOR_TOOL_LOG)) {
      agyWorkspace = stageAgyHooks({ cwd: row.cwd, hookSink: host ? join(isolated.TMPDIR, 'agy-hooks.jsonl') : eventPath(project, row.addr),
        allowNativeQuestions: questions });
      launchArgs.push('--add-dir', agyWorkspace);
    }
    if (row.role === 'worker' && executable) recordWorkerExecutable(project, row, executable, 'probe');
    let installation = await runtime.installation({ env: probe });
    if (installation.kind !== 'available') throw new Error(`${row.cli} unavailable: ${installation.reason ?? installation.kind}`);
    if (row.cli === 'opencode') Object.assign(env, memoryLaunch(row.cli, {
      ...row.memory, openCodeConfig: env.OPENCODE_CONFIG_CONTENT ?? process.env.OPENCODE_CONFIG_CONTENT,
      openCodeNative: !/^(?:opencode\s+)?v?1\./u.test(installation.version ?? ''),
    }).env);
    if (row.cli === 'claude') {
      if (resolveClaudeExecutable(installation.command) !== executable) throw Object.assign(
        new Error('Claude must be launched through the CCP entry'), { code: 'ccp-required' });
      installation = { ...installation, command: executable };
    } else if (executable) {
      if (resolveNativeExecutable(installation.command) !== executable) throw new Error('Worker installation changed during probe');
      installation = { ...installation, command: executable };
    }
    if (row.cli === 'agy') await preflightAgyAcp(installation.command, row.cwd, { ...probe, GEMINI_HOME: env.GEMINI_HOME }, launchArgs);
    if (host) installation = { ...installation, command: hostWriteBoundary(project, row, isolated, installation.command) };
    if (login) installation = { ...installation, command: sandboxNativeWorker(project, row, login, isolated, installation.command) };
    integration = await integrationPs(row, isolated, managed.PATH);
    if (integration) {
      Object.assign(env, integration.env);
      if (row.cli === 'codex') launchArgs = codexConfiguration(project, row, { ...managed, ...integration.env }, isolated);
    }
    const { cwd, model, effort } = row;
    if (row.cli === 'codex') launchArgs.push(...codexDeveloperArgs(row.memory?.indexText));
    await beforeLaunch?.();
    if (row.role === 'worker' && executable) recordWorkerExecutable(project, row, executable, 'launch');
    const session = await runtime.session(installation, { cwd, model, effort, env, launchArgs,
      ...(row.cli === 'claude' && row.memory?.indexText && { appendSystemPrompt: row.memory.indexText }),
      ...(row.cli === 'claude' && !questions && { disallowedTools: ['AskUserQuestion'] }),
      ...(row.cli === 'codex' && { endTurnProcessesOnAbort: true }), ...(resume ? { resume } : {}) });
    installationVersions.set(session, installation.version);
    if (agyWorkspace || integration) {
      const dispose = session.dispose.bind(session);
      session.dispose = async () => {
        try { return await dispose(); }
        finally {
          if (agyWorkspace) rmSync(agyWorkspace, { recursive: true, force: true });
          integration?.close();
        }
      };
    }
    return session;
  } catch (error) {
    if (agyWorkspace) rmSync(agyWorkspace, { recursive: true, force: true });
    integration?.close();
    throw error;
  }
}

export async function bindOarTranscript(session, row) {
  const reported = checkedTranscript(await session.nativeSessionFile?.(), row);
  if (reported) return reported;
  return checkedTranscript(await adapters[row.cli]?.transcript.locate({ cwd: row.cwd, sessionId: session.id }), row);
}

export function trackOar(project, row, session, onError, incarnation, onExit, accounts = {}) {
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
  const prompts = new Map();
  const cliVersion = installationVersions.get(session) ?? session.cliVersion;
  const accountBinding = { ...accounts.binding, cliVersion, sessionId: session.id, generation: incarnation ?? streamId };
  let accountIncident;
  let unsubscribeRaw;
  let readingRaw = true;

  function stopRaw() {
    readingRaw = false;
    unsubscribeRaw?.();
    unsubscribeRaw = undefined;
  }

  function onRaw(frame) {
    if (!readingRaw || frame.kind !== 'frame' || frame.sessionId !== session.id ||
        !Array.isArray(frame.agentPath) || frame.agentPath.length) return;
    const diagnostics = [];
    const native = frame.body?.native;
    const observations = parseClaudeRateLimitEvent(native, { ...accountBinding, sequence: frame.seq,
      observedAt: frame.receivedAt, isReplay: true, observeAccountDiagnostics: batch => diagnostics.push(...batch) });
    if (incarnation && (observations.length || diagnostics.length)) {
      append(frame, 'account-evidence', { observations, diagnostics });
    } else {
      if (observations.length) accounts.observeAccounts?.(observations);
      if (diagnostics.length) accounts.observeAccountDiagnostics?.(diagnostics);
    }
  }

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
    if (event.kind === 'app_request') {
      const kind = appRequestKind(event.type);
      if (kind === 'approval' || kind === 'question') {
        const request = session.records().findLast(record => record.kind === 'request' && record.id === event.requestId);
        const prompt = codexPrompt(event.type, request?.body?.native) ?? promptDetails(kind === 'approval' ? approval : choice);
        prompts.set(event.requestId, { ...prompt, since: event.receivedAt, cli: row.cli, source: 'native' });
      }
    } else if (event.kind === 'app_answered') prompts.delete(event.requestId);
    if (['turn_ended', 'exited', 'released'].includes(event.kind)) prompts.clear();
    if (event.kind === 'turn_started') {
      pending = { requestId: event.requestId, id: deliveryId(event.input), seq: event.seq };
      return;
    }
    if (event.kind === 'control_rejected' && pending?.requestId === event.requestId) {
      pending = undefined;
      return;
    }
    if (event.kind === 'exited' || event.kind === 'released' || event.kind.startsWith('compaction_')) {
      append(event, event.kind, event.kind.startsWith('compaction_') ? { outcome: event.outcome } :
        { suspending, ...(event.kind === 'exited' && { exitCode: event.exitCode ?? event.code }) });
      if (event.kind === 'exited' || event.kind === 'released') { stopRaw(); onExit?.(); }
    }
    if (event.kind === 'input_dropped' && event.inputId) {
      append(event, 'input-dropped', { inputId: event.inputId });
    }
    if (event.kind === 'usage') append(event, 'usage', { ...(active && { turn: active.turn, turnId: active.turnId }), usage: event.usage });
    if (!active && activeEvents.has(event.kind)) {
      const turn = ++number;
      const status = session.status().value;
      const sinceSeq = pending?.seq ?? status.sinceSeq ?? event.seq;
      const turnId = event.spanId ?? event.turnId ?? `${streamId}:${turn}`;
      const start = nextHead ?? headAt(row.cwd);
    active = { sinceSeq, turnId, turn, since: event.receivedAt, inputIds: new Set(), text: '' };
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
        input: event.input, exitCode: event.exitCode, result: event.result, status: event.status,
        content: event.content?.filter(part => part.type === 'text') });
    }
    if (['text_delta', 'reasoning'].includes(event.kind) && !active.progress) {
      append(event, 'model-progress', { turn, turnId });
      active.progress = true;
    }
    if (event.kind !== 'turn_ended') return;
    const outcome = event.outcome;
    const reason = rateFailure.has(outcome.failure) ? 'rate-limit' : outcome.failure === 'auth' ? 'auth' : undefined;
    if (reason || accountIncident && outcome.kind === 'completed') {
      const observed_at = accountTime(event.receivedAt);
      const bucket = /^seven_day(?:_(?:opus|sonnet|haiku|fable))?$|^five_hour$/.test(outcome.rateLimitType) ?
        outcome.rateLimitType : undefined;
      const next = reason && { status: reason === 'auth' ? 'auth-expired' : 'quota-wait',
        observed_at, resets_at: accountTime(outcome.resetsAt), ...(row.cli === 'claude' && bucket && { limit_id: 'claude', bucket }) };
      const incidents = [
        ...(accountIncident && (!next || accountIncident.status !== next.status || accountIncident.bucket !== next.bucket) ?
          [{ ...accountIncident, cleared_at: observed_at }] : []),
        ...(next ? [next] : []),
      ];
      accountIncident = next;
      if (incarnation) {
        try { for (const incident of incidents) append(event, 'account-incident', { incident }); }
        catch { onError(new Error('Could not collect OAR account incident')); }
      } else if (accountBinding.accountRef && incidents.length) {
        try {
          accounts.observeAccountIncidents?.(incidents.map(incident => ({
            cli: row.cli, account_ref: accountBinding.accountRef, session_id: row.addr, ...incident,
          })));
        } catch { onError(new Error('Could not collect OAR account incident')); }
      }
    }
    if (reason && failure !== reason) append(event, 'stuck', { reason, turn });
    if (!reason && failure) append(event, 'recovered', { reason: failure, turn });
    failure = reason;
    const text = outcome.kind === 'completed' && active.text.trim() ? active.text : null;
    const unconfirmed = outcome.kind === 'completed' && acpProviders.has(row.cli);
    append(event, 'turn-end', {
      turn, turnId, nativeTurnId: active.nativeTurnId, sinceSeq, outcome, inputIds: [...active.inputIds],
      ...captureOarTurnEnd(project, row),
      ...(outcome.kind === 'aborted' && { interruptedBy: active.interruptedBy ?? outcome.by ?? null }),
      finalReply: unconfirmed ? null : text,
      ...(unconfirmed && { unconfirmed: true, unconfirmedBody: text }),
    });
    active = pending = undefined;
  }

  let error;
  append({ seq: -1, receivedAt: Date.now() }, 'stream-opened',
    typeof cliVersion === 'string' && /^v?\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/i.test(cliVersion) ? { cliVersion } : {});
  const unsubscribe = session.events(event => {
    if (error) return;
    try { onEvent(event); }
    catch (failure) { error ??= failure; onError(failure); }
  }, { cursor: { sessionId: session.id, afterSeq: session.records().at(-1)?.seq ?? -1 } });
  if (row.cli === 'claude' && (incarnation || accounts.observeAccounts || accounts.observeAccountDiagnostics) && session.rawEvents) {
    unsubscribeRaw = session.rawEvents(frame => {
      try { onRaw(frame); }
      catch { onError(new Error('Could not collect Claude account evidence')); }
    }, { sessionId: session.id, afterSeq: -1 });
    if (!readingRaw) stopRaw();
  }
  function clearInactive() {
    if (!active) return;
    const { turn, turnId, sinceSeq } = active;
    append({ seq, receivedAt: Date.now() }, 'turn-unconfirmed', { turn, turnId, sinceSeq });
    active = pending = undefined;
  }
  return { session, provider: row.cli, streamId, rows, active: () => active, userPrompt: () => prompts.values().next().value, clearInactive, unsubscribe: () => { stopRaw(); unsubscribe(); },
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
  const contextUsage = runtime?.session.contextUsage?.()?.value;
  const userPrompt = !ended && !status?.released && runtime?.userPrompt?.();
  const state = ended || status?.released ? 'finished' : userPrompt?.kind ?? (!status ? 'unknown' :
    status.kind === 'running' ? 'busy' : 'idle');
  const current = runtime?.active();
  const active = status?.kind === 'running' ? {
    hcTurn: current?.turn ?? events.findLast(event => event.type === 'turn-start')?.turn ?? 0,
    streamId: runtime.streamId, sinceSeq: current?.sinceSeq ?? status.sinceSeq, turnId: current?.turnId,
    since: current?.since ?? status.lastEventAt,
  } : undefined;
  return { state, terminal: { turn: current?.turn ?? events.findLast(event => event.type === 'turn-end')?.turn ?? 0 },
    active, events, ...(userPrompt && { userPrompt }), strictEnd: true,
    runtimeStatus: status && (contextUsage ? { ...status, contextUsage } : status), streamId: runtime?.streamId };
}

export function oarEnd(frame, observation) {
  const stop = observation.events.find(event => event.type === 'turn-end' &&
    event.streamId === frame.streamId && event.sinceSeq === frame.sinceSeq &&
    (!frame.turnId || event.turnId === frame.turnId));
  return stop && { at: stop.at, canceled: stop.outcome.kind === 'aborted' };
}

export function oarDelivery(message, observation) {
  const stopping = message.phase === 'stopping';
  const action = stopping ? 'abort' : message.mode === 'steer' ? 'steer' : 'prompt';
  const events = observation.events.filter(event => event.at >= (stopping ? message.stopAttemptAt : message.attemptAt));
  const start = events.find(event => event.type === 'input-received' && event.inputId === message.id);
  const end = events.find(event => event.type === 'turn-end' && (event.inputIds?.includes(message.id) ||
    (start && start.turnId === event.turnId && start.streamId === event.streamId)));
  if (!start && !end) {
    const failure = events.find(event => event.type === 'input-failed' && event.inputId === message.id && event.action === action &&
      (!message.hostAttempt || event.incarnation === (stopping ? message.hostStopAttempt : message.hostAttempt)));
    if (failure) return { failed: failure.reason, at: failure.at };
    if (events.some(event => event.type === 'input-dropped' && event.inputId === message.id)) return { dropped: true };
    return;
  }
  const { at, sessionId, turnId, streamId } = start ?? end;
  return { at, sessionId, turnId, streamId, ...(end && { completion: {
    at: end.at, sessionId, turnId, nativeTurnId: end.nativeTurnId, nativeTurnIndex: end.turn,
    source: end.source ?? 'OAR turn-end', outcome: end.outcome,
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
      await session[action](wireText(message.id, message.text.toWellFormed()), { inputId: message.id });
  } catch (error) {
    undoAbort?.();
    throw error;
  }
  if (result.kind === 'accepted') return result;
  undoAbort?.();
  const native = result.response?.body?.native;
  const mapped = runtime.provider === 'codex' && native && codexRefusal(
    { prompt: 'turn/start', steer: 'turn/steer', abort: 'turn/interrupt' }[action], native);
  const kind = mapped || (action === 'steer' && ['unsupported', 'no_active_turn'].includes(result.code) ? 'steer-unavailable' :
    ['busy', 'no_active_turn', 'disposed'].includes(result.code) ? 'status_mismatch' :
      ['runtime_exited', 'runtime_refused', 'error'].includes(result.code) ? undefined : 'input-refused');
  throw Object.assign(new Error(`OAR ${action}: ${result.code}`), { kind });
}
