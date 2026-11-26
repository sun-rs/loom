import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { CommandError as ErrorCode, resolveTarget } from '../cli/sessions.mjs';
import { runtimeDirectory } from '../cli/project.mjs';
import { roles, rotatingRoles } from '../index/index.mjs';
import { hc, tui, addressPattern } from '../inbox/tui.mjs';
import { wireText } from '../inbox/message.mjs';
import { recordLifecycle } from '../handover/index.mjs';
import { generateBrief } from '../handover/brief.mjs';
import { eventPath, jsonRows, readText, syncDirectory, writeState } from './io.mjs';
import { bindOarTranscript, checkedTranscript, oarControl, oarDelivery, oarEnd, oarSnapshot, trackOar } from './oar.mjs';
import { openCodeExport, openTui, ownedPane, refreshOpenCode } from './tui.mjs';
import { tuiHolders } from './tui-holder.mjs';
import { recoverCodexEnd, recoverNativeDelivery } from './recovery.mjs';
import { claudeAuthMode, spawnProfile, enforceDeny } from '../cli/policy.mjs';
import { headAt, linkTuiInputHead, observeTuiHeads, saveTuiInputHead } from './turn-heads.mjs';
import { controlTui, wrapperFailedStart } from '../runtimes/tui/transport.mjs';
import { controlHello, requestControl } from '../tui/pty-control.mjs';
import { attachHost } from './host-client.mjs';
import { attachCodexHolder, pipeTransport, useCodexHolder } from './codex-holder.mjs';
import { releaseId } from './release.mjs';
import { projectMemoryPrompt } from '../memory/project.mjs';
import { disposeSession } from './session-close.mjs';
import { workerEnvironment } from './worker-environment.mjs';
import { withClaudeTranscriptStops } from '../relay/sources.mjs';

const runtimeIds = { codex: 'codex', agy: 'antigravity', claude: 'claude', opencode: 'opencode' };
const modes = new Set(['tui', 'headless']);
const guardedAbort = new Set(['codex', 'agy', 'opencode']);
export const opencodeExportFailureLimit = 3;
const pipeRecoveryLimit = 4;
const pipeRecoveryWindow = 120_000;
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const temporaryRole = role => ['worker', 'reviewer'].includes(role);
export const validInput = text => hasText(text) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text);
const cardConventions = row => [
  '## Loom task conventions',
  `Task ${row.task}, working directory ${row.cwd}. Follow the card’s writable scope and acceptance commands. Start with the card and skip environment exploration or searches for AGENTS.md and skills to discover Loom conventions.`,
  'Invoke Loom commands through "$LOOM_BIN", the absolute executable path.',
  'Keep Git hooks enabled. Git --no-verify, core.hooksPath overrides, and equivalent bypasses are forbidden.',
  'Use relevant fragments of large files and output. Avoid rereading whole files already read. After the final acceptance passes, give the final reply immediately. Skip extra status/diff checks, rereads and reruns unless the card requires them.',
  `Final reply line 1: DONE ${row.task}, BLOCKED ${row.task} or FAILED ${row.task}.`,
  'Line 2: a one-line conclusion with the deliverable or the blocking decision. Line 3: Leftovers & deviations: none, or list the specific items.',
  'When applicable, add one line each for a design trade-off, why an old assertion changed and what replaced it, and what was not verified and why. Loom collects Git and test evidence and publishes receipts.',
].join('\n');

function within(parent, child) {
  const path = relative(parent, child);
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
}

function gitHead(cwd) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8', timeout: 5000 }).trim();
  } catch (error) {
    // Standalone workspaces have no Git baseline.
    if (error.status === 128) return null;
    throw error;
  }
}

function completedPane(terminal) {
  return terminal?.state === 'finished';
}

function inProjectDirectory(project, cwd) {
  const directory = realpathSync(cwd);
  if (!within(project, directory) || !statSync(directory).isDirectory()) {
    throw new ErrorCode('invalid-arguments', 'Session cwd must be a directory inside the project');
  }
  return directory;
}

function defaultTrustWorkspace(project, cwd) {
  if (cwd === project) return true;
  try {
    const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain', '-z'], {
      cwd: project, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8', timeout: 5000,
    });
    return worktrees.split('\0\0').some(entry => entry.split('\0')[0] === `worktree ${cwd}`);
  } catch { return false; }
}

export function ownedSessions(project, index, report, {
  open, openPane = openTui, getPane = ownedPane, callHc = hc, controller,
} = {}) {
  const path = join(runtimeDirectory(project), 'sessions');
  mkdirSync(path, { recursive: true, mode: 0o700 });
  syncDirectory(runtimeDirectory(project));
  const jobs = new Map();
  const running = new Map();
  const restored = new Set();
  const bindings = new Map();
  const activity = new Map();
  const retryAt = new Map();
  const openCodeProofs = new Map();
  const rows = addr => index.query(addr ? { addr } : {});
  const rowFor = addr => addr ? rows(addr)[0] : undefined;
  const file = addr => join(path, `${addr}.json`);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!entry.isFile() || !/^(?:loom|oar)-[0-9a-f-]{36}\.json$/.test(entry.name)) continue;
    const job = JSON.parse(readText(join(path, entry.name)));
    if (file(job.row.addr) !== join(path, entry.name) || !within(project, job.row.cwd)) throw new Error('Invalid stored session');
    jobs.set(job.row.addr, job);
  }
  const save = job => writeState(file(job.row.addr), JSON.stringify(job) + '\n');
  const holders = tuiHolders(project, controller, save);
  const events = addr => running.get(addr)?.rows ?? jsonRows(readText(eventPath(project, addr)));
  const transportReceipt = metadata => metadata && { transport: metadata.transport, reason: metadata.reason };
  const bound = (row, extra = {}) => ({ addr: row.addr, cwd: row.cwd, provider: row.cli,
    createdAt: row.startedAt, backend: row.backend, ...extra });

  async function managedHc(command, addr, ...args) {
    const job = jobs.get(addr);
    const row = job && rowFor(addr);
    if (!row || !row.pane) throw Object.assign(new Error(`No owned pane for ${addr}`), { kind: 'not_found' });
    const terminal = await callHc('get', row.pane);
    if (terminal.address !== row.pane || terminal.created_ms !== job.paneBinding?.createdAt ||
        terminal.pid !== job.paneBinding?.pid || realpathSync(terminal.cwd) !== row.cwd) throw new Error('hc pane identity changed');
    if (command === 'get') return { ...terminal, address: addr, labels: { ...terminal.labels, 'loom-cli': row.cli } };
    return callHc(command, row.pane, ...args);
  }

  // Injected protocol fixtures emulate the preexisting hc-shaped native peer.
  const fixtureSend = callHc !== hc && ((message, snapshot) => managedHc('send', message.target.addr,
    wireText(message.id, message.text), ...(snapshot.terminal.status?.state === 'idle' ? ['--if', 'idle'] : [])));
  const local = tui(project, managedHc, fixtureSend, async (binding, method, params, addr) => {
    if (binding.transport !== 'holder-v3') return controlTui(binding, method, params);
    const row = rowFor(addr);
    const job = jobs.get(addr);
    const pane = await getPane(job, row);
    if (!pane || completedPane(pane)) throw new Error('Owned holder pane is unavailable');
    const { session } = await holders.attach(job, row, pane);
    if (method === 'state') return session.readState();
    if (method === 'confirmations') return session.confirmations(params.id);
    if (['submit', 'interrupt', 'dialog'].includes(method)) return session[method](params);
    throw new Error('Unknown holder controller method');
  });
  const transport = {
    async inspect(target) {
      const row = rowFor(target.addr);
      if (target.backend === 'headless') {
        const runtime = running.get(target.addr);
        if (row?.endedAt == null) await runtime?.pull?.();
        const snapshot = oarSnapshot(runtime, events(target.addr), row?.endedAt != null || runtime?.endedAt != null);
        return { ...snapshot, ...(row?.endedAt === null && runtime?.stuck &&
          { state: 'stuck', reason: runtime.stuck.reason }), ...(row?.endedAt === null && jobs.get(row.addr)?.pipeRecovery?.exhausted &&
          { state: 'stuck', reason: 'codex-resume-exhausted' }),
          hostIncarnation: runtime?.incarnation, row };
      }
      if (row?.endedAt != null) return { state: 'finished', provider: row.cli, tui: jobs.get(row.addr)?.tui,
        terminal: { cwd: row.cwd, address: target.addr },
        events: events(target.addr).filter(event => !event.agent_id &&
          (!row.sessionId || (event.session_id ?? event.conversationId) === row.sessionId)) };
      const job = jobs.get(target.addr);
      const snapshot = await local.inspect({ ...target, tui: job?.tui, sessionId: row?.sessionId });
      if (job?.exportFailure?.count >= opencodeExportFailureLimit && snapshot.state !== 'finished') {
        return { ...snapshot, state: 'stuck', reason: 'opencode-export-failed', urgentReady: false, active: undefined };
      }
      return snapshot;
    },
    sameTurn(frame, current) {
      return frame?.streamId ? current?.streamId === frame.streamId && current?.sinceSeq === frame.sinceSeq :
        Boolean(frame && local.sameTurn(frame, current));
    },
    turnEnd(frame, observation) {
      return frame?.streamId ? oarEnd(frame, observation) ?? recoverCodexEnd(observation.row, frame) :
        local.turnEnd(frame, observation);
    },
    turnReplaced(frame, observation) {
      return Boolean(frame.streamId && observation.streamId && observation.streamId !== frame.streamId);
    },
    deliveryTurnReplaced(message, observation) {
      const streamId = message.received.streamId ?? message.nativeAttempt?.streamId;
      return Boolean(streamId && observation.streamId && observation.streamId !== streamId);
    },
    nativeDelivery(message, observation) {
      if (message.target.backend !== 'headless') {
        const native = local.nativeDelivery(message, observation);
        const row = rowFor(message.target.addr);
        try { if (row) linkTuiInputHead(project, row, message, native); }
        catch (error) { report(error.message); }
        return native;
      }
      const recorded = oarDelivery(message, observation);
      const runtime = running.get(message.target.addr);
      const completion = recorded?.completion;
      const row = rowFor(message.target.addr);
      if (completion?.outcome?.kind === 'completed' && !completion.body) {
        let body;
        let replySource = 'native transcript';
        if (['codex', 'agy'].includes(row?.cli)) {
          const native = recoverNativeDelivery(row, message)?.completion;
          if (native?.sessionId === completion.sessionId &&
              (row.cli === 'agy' || !completion.nativeTurnId || completion.nativeTurnId === native.nativeTurnId)) body = native.body;
        } else if (row?.cli === 'opencode') {
          const proof = openCodeProofs.get(row.addr);
          if (proof?.turnId === completion.turnId) {
            body = proof.events?.find(event => event.session_id === completion.sessionId &&
              event.deliveryId === message.id && event.hook_event_name === 'Stop')?.last_assistant_message;
            replySource = 'OpenCode session export';
          }
        }
        if (body && (!completion.unconfirmedBody || completion.unconfirmedBody.trim() === body.trim())) {
          const { noReply, unconfirmed, unconfirmedBody, ...verified } = completion;
          return { ...recorded, completion: { ...verified, body, replySource } };
        }
      }
      if (recorded?.completion || recorded?.dropped || recorded?.failed || runtime?.streamId &&
          runtime.streamId === message.nativeAttempt?.streamId && !message.issue) return recorded;
      const native = recoverNativeDelivery(row, message);
      return native?.completion ? native : recorded ?? native;
    },
    plan: (provider, mode) => local.plan(provider, mode),
    async send(message, observation) {
      if (message.target.backend !== 'headless') {
        try { saveTuiInputHead(project, rowFor(message.target.addr), message); }
        catch (error) { report(error.message); }
        return local.send(message, observation);
      }
      const runtime = running.get(message.target.addr);
      const action = message.mode === 'steer' ? 'steer' : 'prompt';
      const result = runtime.hosted ? await runtime.control(action, message) : await oarControl(runtime, action, message, observation);
      return { streamId: runtime.streamId, requestId: result.requestId, seq: result.seq, deadlineAt: result.deadlineAt };
    },
    async retryMissingTurn(message, observation) {
      return local.retryMissingTurn(message, observation);
    },
    async interrupt(message, _keys, observation) {
      if (!canInterrupt(message.target)) throw Object.assign(new Error('Target does not support guarded interruption'), { kind: 'input-refused' });
      if (message.target.backend === 'tui') return local.interrupt(message, observation);
      const runtime = running.get(message.target.addr);
      return runtime.hosted ? runtime.control('abort', message) : oarControl(runtime, 'abort', message);
    },
    async recoverAttempt(message, observation) {
      const runtime = running.get(message.target.addr);
      if (!runtime?.hosted || observation.state === 'finished') return;
      const stopping = message.phase === 'stopping';
      if (runtime.incarnation !== (stopping ? message.hostStopAttempt : message.hostAttempt)) return;
      const action = stopping ? 'abort' : message.mode === 'steer' ? 'steer' : 'prompt';
      return runtime.receipt(action, message.id);
    },
  };

  function rememberUserPrompt(addr, snapshot, at) {
    const job = jobs.get(addr);
    const prompt = snapshot?.userPrompt;
    if (!job || !snapshot) return prompt;
    const previous = job.userPrompt;
    if (!prompt) {
      if (previous && snapshot.state !== 'unknown') {
        delete job.userPrompt;
        save(job);
      }
      return;
    }
    const since = previous?.kind === prompt.kind &&
      !(prompt.source === 'native' && previous.source === 'native' && prompt.since > previous.since) ?
      previous.since : Math.min(prompt.since ?? at, at);
    const current = { ...prompt, since };
    if (JSON.stringify(previous) !== JSON.stringify(current)) {
      job.userPrompt = current;
      save(job);
    }
    return current;
  }

  function targetBinding(row) {
    const job = jobs.get(row.addr);
    if (!job) throw new ErrorCode('not-found', `Session is not managed by this daemon: ${row.addr}`);
    return bindings.get(row.addr) ?? bound(row, { ...job.paneBinding, tui: transportReceipt(job.tui) });
  }

  function requestedMode(binding, mode, active) {
    if (mode !== 'steer') return mode;
    if (!active) return 'queue';
    if (binding.backend === 'headless') return running.get(binding.addr)?.session.steer && binding.provider !== 'agy' ? 'steer' : 'queue';
    return 'queue';
  }

  function canInterrupt(binding) {
    return binding.backend === 'headless' ? guardedAbort.has(binding.provider) :
      ['loom-pty', 'holder-v3'].includes(jobs.get(binding.addr)?.tui?.transport) && binding.provider !== 'opencode';
  }

  async function finish(job, row, at = Date.now()) {
    openCodeProofs.delete(row.addr);
    holders.detach(job.tui);
    const final = row.endedAt === null ? index.update(row.addr, { endedAt: Math.max(row.startedAt, at) }) : row;
    if (!temporaryRole(row.role) && final.transcriptPath && !job.endRecorded) {
      const result = await recordLifecycle(project, final, { kind: 'exited', at: final.endedAt, eventId: `${row.addr}:exit` },
        { locate: false }).catch(error => report(error.message));
      if (result?.status === 'recorded') { job.endRecorded = true; save(job); }
    }
    return final;
  }

  function requireLive(row) {
    if (row.endedAt !== null) throw new ErrorCode('not-ready', `Session has ended: ${row.addr}`);
  }

  function successorOf(addr) {
    return [...jobs.values()].find(job => job.handoverBound && job.handoverFrom === addr);
  }

  function routeParent(addr) {
    const row = rowFor(addr);
    if (!row || !row.role || temporaryRole(row.role)) return row;
    let current = row;
    let live = row.endedAt === null ? row : undefined;
    for (let next = successorOf(current.addr); next; next = successorOf(current.addr)) {
      current = rowFor(next.row.addr);
      if (current.endedAt === null) live = current;
    }
    if (current.endedAt === null) return current;
    return rows().findLast(candidate => candidate.role === current.role && candidate.project === current.project &&
      candidate.startedAt > current.startedAt && candidate.endedAt === null && restored.has(candidate.addr)) ?? live ?? current;
  }

  function checkRotation(name, role, successor) {
    if (!rotatingRoles.includes(role)) return;
    const pending = index.rotations().find(item => item.project === name && item.successor !== successor &&
      item.verifiedAt === null && item.failedAt === null);
    if (pending) throw new ErrorCode('rotation-in-progress', `${pending.role} rotation to ${pending.successor} awaits a verified report`);
  }

  function beginRotation(job, old) {
    if (!rotatingRoles.includes(job.row.role)) return;
    const { addr: successor, project: name, role } = job.row;
    const pending = index.beginRotation({ successor, predecessor: old.addr, project: name, role, startedAt: Date.now() });
    if (pending) throw new ErrorCode('rotation-in-progress', `${pending.role} rotation to ${pending.successor} awaits a verified report`);
  }

  function bindSuccessor(old, row, beforeBind) {
    const job = jobs.get(row.addr);
    if (!old || !job || !restored.has(row.addr) || temporaryRole(old.role) || old.role !== row.role ||
        old.project !== row.project || !(old.startedAt < row.startedAt) || row.endedAt !== null ||
        job.handoverFrom && job.handoverFrom !== old.addr ||
        successorOf(old.addr) && successorOf(old.addr) !== job) {
      throw new ErrorCode('invalid-arguments', 'Handover requires a newer bound session of the same resident role and project');
    }
    checkRotation(row.project, row.role, row.addr);
    const notice = beforeBind?.();
    if (job.handoverBound) return;
    const previous = job.handoverFrom;
    job.handoverFrom = old.addr;
    job.handoverBound = true;
    job.handoverReportId = notice?.id ?? job.firstId;
    job.handoverBoundAt = Date.now();
    try { save(job); }
    catch (error) {
      job.handoverFrom = previous;
      delete job.handoverBound;
      delete job.handoverReportId;
      delete job.handoverBoundAt;
      throw error;
    }
    beginRotation(job, old);
    if (rotatingRoles.includes(row.role)) index.bindRotation(row.addr, job.handoverBoundAt);
  }

  async function retirePredecessor(job) {
    if (!job.handoverBound) return;
    const old = rowFor(job.handoverFrom);
    if (old?.endedAt !== null || !jobs.has(old.addr)) return;
    const successor = routeParent(old.addr);
    if (successor.addr === old.addr || successor.endedAt !== null) return;
    return stop(old);
  }

  function resolve(target, caller) {
    const sessions = rows();
    const callerAddr = sessions.find(row => row.pane === caller || row.addr === caller)?.addr;
    return sessions.find(row => row.pane === target) ?? resolveTarget(sessions, target, callerAddr);
  }

  async function newJob(input, caller, checkBarrier, occupies) {
    if (!roles.includes(input.role) || !hasText(input.cwd) || !validInput(input.prompt) ||
        (input.parent !== undefined && !hasText(input.parent)) ||
        (input['trust-workspace'] !== undefined && typeof input['trust-workspace'] !== 'boolean') ||
        (input['expect-red'] !== undefined && (input.role !== 'worker' || typeof input['expect-red'] !== 'boolean')) ||
        (input.cli !== undefined && !Object.hasOwn(runtimeIds, input.cli)) ||
        (input.mode !== undefined && !modes.has(input.mode)) ||
        (input.defaultMode !== undefined && !modes.has(input.defaultMode)) ||
        (input.deliver !== undefined || input.barrier !== undefined) &&
          (input.role !== 'worker' || !['stream', 'barrier'].includes(input.deliver) ||
            (input.deliver === 'barrier' ? !addressPattern.test(input.barrier ?? '') : input.barrier !== undefined)) ||
        ['model', 'effort'].some(key => input[key] !== undefined && !hasText(input[key])) ||
        ['task', 'wave'].some(key => (input.role === 'worker' || input[key] !== undefined) && !addressPattern.test(input[key] ?? ''))) {
      throw new ErrorCode('invalid-arguments', 'spawn requires role, cwd and prompt. Workers require task and wave, and barrier delivery requires a set ID.');
    }
    const cwd = inProjectDirectory(project, input.cwd);
    const predecessor = input['handover-from'] && rowFor(input['handover-from']);
    if (input['handover-from'] !== undefined && (!predecessor || !jobs.has(predecessor.addr) ||
        temporaryRole(input.role) || predecessor.role !== input.role ||
        input.parent && input.parent !== predecessor.addr || successorOf(predecessor.addr))) {
      throw new ErrorCode('invalid-arguments', '--handover-from requires an unreplaced managed address of the same resident role');
    }
    const actor = caller && rows().find(row => row.pane === caller || row.addr === caller);
    const parent = predecessor ?? (input.parent ? resolve(input.parent, caller) : actor);
    if (input.role === 'reviewer' && parent && (actor && actor.addr !== parent.addr ||
        parent.endedAt !== null || !jobs.has(parent.addr))) {
      throw new ErrorCode('invalid-arguments', 'A reviewer result requires its live, managed spawning role');
    }
    const existing = new Set(rows().map(row => row.project));
    const name = parent?.project ?? (existing.size === 1 ? existing.values().next().value : project);
    if (predecessor) checkRotation(name, input.role);
    const deliver = input.role === 'worker' ? input.deliver ?? 'stream' : undefined;
    let gate;
    if (deliver === 'barrier') {
      if (parent?.endedAt === null) gate = (await transport.inspect(targetBinding(parent))).active;
      await checkBarrier(parent?.addr ?? null, name, input.barrier, gate);
    }
    const { requested, selected, deny, maxDurationMs, warnings, fastRequested, trustWorkspace } = spawnProfile(project,
      input.role === 'worker' ? { ...input, workerCaller: caller ?? null } : input, addr => routeParent(addr)?.addr, occupies);
    const { cli, mode, model, effort } = selected;
    const addr = `${mode === 'headless' ? 'oar' : 'loom'}-${randomUUID()}`;
    const runtimeId = mode === 'tui' ? `${cli}-tui` : runtimeIds[cli];
    const row = { addr, role: input.role, project: name, task: input.task, wave: input.wave,
      backend: mode, runtimeId, cli, model, effort, cwd, baseCommit: gitHead(cwd), parent: parent?.addr ?? null,
      startedAt: [...jobs.values()].reduce((at, job) => Math.max(at, job.row.startedAt + 1), Date.now()) };
    let prompt = input.prompt;
    if (predecessor) {
      const { brief } = await generateBrief({ role: input.role, project: name, projectDir: project, from: predecessor.addr,
        index, locate: false });
      prompt = `先读前任简报及任务指定的交接记录，再开始接管。\n\n${brief.trimEnd()}\n\n## 启动指令\n${prompt}`;
    }
    if (row.role === 'leader' || row.role === 'auditor') {
      const guidance = row.role === 'leader' ?
        'Coordinate work. Workers reproduce issues and run full test suites in their own sandboxes. Review their receipts and signals. Spawn an independent Reviewer on the fixed candidate with --wave set to the gate ID. Receive the conclusion before running loom gate pack. Use loom escalate for confirmed red facts, sharing one wake per gate with the packet.' :
        'For gate review, read only the gate packet and reviewer conclusions. The Leader commissions the independent review before packing. Delegate deep checks to one ephemeral read-only reviewer. Its conclusion may wake you once and counts against your gate wake budget. Other wake sources are user or Super messages, a gate packet or red escalation from Leader, and succession supervision. ';
      prompt = `## Loom role guidance\n${guidance} Assign long-running work to a Worker or Reviewer. Do not wait on background Bash. For a user or Super decision, write the choices in a file and run "$LOOM_BIN" notifications --needs-decision TEXT --kind decision with a short summary and its path. Keep working where possible. The decision arrives as a normal delivery. If a result is overdue, run "$LOOM_BIN" status and check stalled deliveries. Begin conclusions with DONE, BLOCKED, FAILED, PASS, REJECT or APPROVE. Use NOREPLY for acknowledgements.\n\n## Startup request\n${prompt}`;
      try { prompt = await projectMemoryPrompt(project) + prompt; }
      catch (error) { report(`Project memory unavailable: ${error.message}`); }
    }
    if (row.role === 'worker') prompt += `\n\n${cardConventions(row)}`;
    if (row.role === 'reviewer') prompt = [
      'You are a one-turn Loom reviewer. Inspect read-only and answer the one question below. Do not edit files, change repository state, run broad test suites or delegate. Send only your conclusion to the spawning role. Start it with PASS, REJECT or BLOCKED and cite the evidence.',
      prompt,
    ].join('\n\n');
    const job = { row, firstId: randomUUID(), prompt, gate, requested, deny, release: releaseId(),
      ...(actor && jobs.has(actor.addr) && { sender: targetBinding(actor) }),
      ...(row.role === 'worker' && { isolatedWorkerHome: true }),
      ...(cli === 'claude' && mode === 'tui' && { autoTrustWorkspace: input['trust-workspace'] ??
        (trustWorkspace && defaultTrustWorkspace(project, cwd)) }),
      ...(warnings.length && { warnings }),
      ...(fastRequested !== undefined && { fastRequested }),
      ...(selected.fast !== undefined && { fast: selected.fast }),
      ...(predecessor && { handoverFrom: predecessor.addr }),
      ...(row.role === 'worker' && { cardStart: headAt(cwd) }),
      ...(input['expect-red'] !== undefined && { expectRed: input['expect-red'] }),
      ...(deliver && { deliver, ...(input.barrier && { barrier: input.barrier }) }),
      ...(row.role === 'reviewer' && { reviewDeadline: row.startedAt + maxDurationMs }),
      ...(cli === 'opencode' && mode === 'tui' && { plannedNativeId: `ses_${randomUUID().replaceAll('-', '')}` }) };
    save(job);
    jobs.set(addr, job);
    return job;
  }

  function runtimeSelection(row) {
    const runtime = running.get(row.addr)?.session;
    const job = jobs.get(row.addr);
    const selected = { cli: row.cli, model: row.model, effort: row.effort, mode: row.backend,
      ...(job?.fast !== undefined && { fast: job.fast }) };
    const effective = { ...selected, model: runtime?.model?.()?.value ?? null, effort: runtime?.effort?.()?.value ?? null };
    if (job?.fast !== undefined) effective.fast = null;
    const unverified = Object.keys(selected).filter(key => effective[key] == null);
    const differences = Object.keys(selected).filter(key => effective[key] != null && effective[key] !== selected[key]);
    const transport = job?.tui ?? job?.host;
    return { selected, effective, differences, unverified,
      ...(job?.authMode && { authMode: job.authMode }),
      ...(job?.fastRequested !== undefined && { fastRequested: job.fastRequested }),
      ...(job?.warnings?.length && { warnings: job.warnings }),
      ...(transport?.transport && { transport: transport.transport, ...(transport.reason && { transportReason: transport.reason }) }) };
  }

  function recordPipeRecovery(job) {
    if (job.host?.transport !== pipeTransport || job.pipeRecovery?.exhausted) return;
    const previous = job.pipeRecovery;
    const at = Date.now();
    const count = (previous?.count ?? 0) + 1;
    const startedAt = previous?.startedAt ?? at;
    job.pipeRecovery = { count, startedAt, at, exhausted: count >= pipeRecoveryLimit || at - startedAt >= pipeRecoveryWindow };
    save(job);
  }

  async function attachHeadless(row, job, options) {
    const pipe = useCodexHolder(row, job);
    const recovery = job.pipeRecovery;
    if (pipe && recovery && !options?.stop && (recovery.exhausted || Date.now() - recovery.startedAt >= pipeRecoveryWindow)) {
      if (!recovery.exhausted) {
        job.pipeRecovery = { ...recovery, exhausted: true, at: Date.now() };
        save(job);
      }
      throw new ErrorCode('not-ready', 'Codex attachment retry budget exhausted');
    }
    try {
      return await (pipe ? attachCodexHolder : attachHost)(project, row, job, save, controller, options);
    } catch (error) {
      if (pipe && !options?.stop) recordPipeRecovery(job);
      throw error;
    }
  }

  async function openFixture(row, job) {
    const session = await open(job.fast === undefined ? row : { ...row, fast: job.fast }, project, row.sessionId);
    try {
      if (row.sessionId && session.id !== row.sessionId) throw new Error('OAR resumed a different native session');
      return trackOar(project, row, session, error => report(error.message));
    } catch (error) {
      await disposeSession(session).catch(failure => report(failure.message));
      throw error;
    }
  }

  async function activate(job, mail) {
    if (job.handoverFrom && !job.handoverBound) beginRotation(job, rowFor(job.handoverFrom));
    if (job.handoverBound && rotatingRoles.includes(job.row.role) &&
        !index.rotations().find(item => item.successor === job.row.addr)?.boundAt) {
      beginRotation(job, rowFor(job.handoverFrom));
      index.bindRotation(job.row.addr, job.handoverBoundAt ?? job.row.startedAt);
    }
    let row = rowFor(job.row.addr) ?? index.register(job.row);
    if (row.endedAt !== null) return row;
    if (job.stopping) return stop(row);
    if (row.backend === 'headless') {
      if (!running.has(row.addr)) {
        const last = events(row.addr).findLast(event => ['stream-opened', 'exited', 'released'].includes(event.type));
        if (!job.host && ['exited', 'released'].includes(last?.type) && !last.suspending) return finish(job, row, last.at);
        const runtime = open ? await openFixture(row, job) : await attachHeadless(row, job);
        if (runtime.endedAt != null) {
          if (runtime.sessionId && row.sessionId !== runtime.sessionId) row = index.update(row.addr, { sessionId: runtime.sessionId });
          const transcriptPath = checkedTranscript(runtime.transcriptPath, row);
          if (transcriptPath && row.transcriptPath !== transcriptPath) row = index.update(row.addr, { transcriptPath });
          return finish(job, row, runtime.endedAt);
        }
        running.set(row.addr, runtime);
        if (runtime.session.id !== row.sessionId) row = index.update(row.addr, { sessionId: runtime.session.id });
      }
      const runtime = running.get(row.addr);
      const transcript = await getOarTranscript(runtime, row).catch(error => report(error.message));
      if (transcript && row.transcriptPath !== transcript) row = index.update(row.addr, { transcriptPath: transcript });
    } else {
      let terminal = await getPane(job, row);
      let nativeId;
      if (!job.paneBinding && completedPane(terminal) && wrapperFailedStart(job.tui)) {
        job.tui = { transport: 'plain-hc', reason: 'loom-pty-start-failed' };
        save(job);
        terminal = undefined;
      }
      if (!terminal && !job.paneBinding) {
        if (row.cli === 'claude') {
          job.authMode = claudeAuthMode(project, row.role);
          save(job);
        }
        const opened = await openPane(job, row, project, temporary => {
          job.temporary = temporary;
          save(job);
        }, binding => {
          job.tui = binding;
          save(job);
        }, controller);
        terminal = opened.terminal;
        nativeId = opened.nativeId;
      }
      if (!terminal || completedPane(terminal)) return finish(job, row, terminal?.finished_ms);
      activity.set(row.addr, terminal.status_ms);
      if (!job.paneBinding) {
        job.paneBinding = { createdAt: terminal.created_ms, pid: terminal.pid };
        save(job);
      }
      if (row.pane !== terminal.address || nativeId && row.sessionId !== nativeId) {
        row = index.update(row.addr, { pane: terminal.address, ...(nativeId && { sessionId: nativeId }) });
      }
      if (job.tui?.transport === 'holder-v3') await holders.attach(job, row, terminal);
      bindings.set(row.addr, bound(row, { ...job.paneBinding, tui: transportReceipt(job.tui) }));
    }
    enforceDeny(runtimeSelection(row).effective, job.deny ?? []);
    if (!mail.messages.some(message => message.id === job.firstId)) {
      mail.enqueue({ id: job.firstId, target: targetBinding(row), createdAt: row.startedAt,
        text: job.prompt, requestedMode: 'queue', mode: 'queue', phase: 'queued', startup: true,
        ...(job.sender && { from: job.sender }),
        ...(row.role === 'worker' && { waveParent: row.parent }) });
    }
    restored.add(row.addr);
    if (job.handoverFrom && !job.handoverBound) bindSuccessor(rowFor(job.handoverFrom), row);
    return row;
  }

  async function failSpawn(job, error) {
    job.error = error.message;
    job.stopping = true;
    save(job);
    const row = rowFor(job.row.addr);
    if (row) await stop(row).catch(cleanup => report(cleanup.message));
    if (job.handoverFrom && rotatingRoles.includes(job.row.role)) index.failRotation(job.row.addr, Date.now(), error.message);
  }

  async function refreshTui(job, row) {
    const terminal = await getPane(job, row);
    if (terminal) activity.set(row.addr, terminal.status_ms);
    if (row.cli === 'opencode' && terminal) {
      try {
        const transcriptPath = await refreshOpenCode(job, row, project);
        if (job.exportFailure) {
          delete job.exportFailure;
          save(job);
        }
        if (row.transcriptPath !== transcriptPath) row = index.update(row.addr, { sessionId: job.plannedNativeId, transcriptPath });
      } catch (error) {
        const count = Math.min((job.exportFailure?.count ?? 0) + 1, opencodeExportFailureLimit);
        if (count !== job.exportFailure?.count) {
          job.exportFailure = { count, at: Date.now(), kind: error.kind ?? 'export-failed' };
          save(job);
          if (count === opencodeExportFailureLimit) report(`${row.addr}: OpenCode export failed ${count} times (${job.exportFailure.kind})`);
        }
      }
    }
    const hooks = events(row.addr);
    const binding = hooks.findLast(event => !event.agent_id && (event.session_id || event.conversationId));
    const sessionId = binding?.session_id ?? binding?.conversationId;
    if (sessionId && (!row.sessionId || row.sessionId === sessionId)) {
      const fallback = binding?.transcript_path ?? binding?.transcriptPath;
      const identity = { ...row, sessionId };
      const located = checkedTranscript(fallback, identity);
      const native = row.cli === 'agy' && located ? checkedTranscript(join(located, '..', 'transcript_full.jsonl'), identity) ?? located : located;
      if (row.sessionId !== sessionId || native && row.transcriptPath !== native) {
        row = index.update(row.addr, { sessionId, ...(native && { transcriptPath: native }) });
      }
    }
    if (row.sessionId) {
      try {
        const bound = hooks.filter(event => !event.agent_id && (event.session_id ?? event.conversationId) === row.sessionId);
        observeTuiHeads(project, row, row.cli === 'claude' ? withClaudeTranscriptStops(row, bound, row.sessionId) : bound);
      }
      catch (error) { report(error.message); }
    }
    if (!terminal || completedPane(terminal)) row = await finish(job, row, terminal?.finished_ms);
    return row;
  }

  async function getOarTranscript(runtime, row) {
    return checkedTranscript(runtime.transcriptPath, row) ?? await bindOarTranscript(runtime.session, row) ??
      (row.cli === 'opencode' ? checkedTranscript(eventPath(project, row.addr)) : null);
  }

  async function refreshOpenCodeProof(runtime, row) {
    if (row.cli !== 'opencode' || !runtime.hosted || !row.sessionId) return;
    const turn = runtime.rows.findLast(event => event.type === 'turn-end' && event.streamId === runtime.streamId && event.unconfirmedBody);
    if (!turn || turn.turnId === openCodeProofs.get(row.addr)?.turnId) return;
    const proof = { turnId: turn.turnId };
    openCodeProofs.set(row.addr, proof);
    try {
      const { events } = await openCodeExport(row, row.sessionId, { ...process.env, ...workerEnvironment(row) },
        process.env.OAR_OPENCODE_BIN ?? process.env.LOOM_OPENCODE_BIN);
      proof.events = events;
    } catch (error) { report(`${row.addr}: ${error.message}`); }
  }

  async function retainCompaction(job, row) {
    if (!row.transcriptPath || temporaryRole(row.role)) return;
    const handled = new Set(job.compactions);
    for (const event of events(row.addr).filter(event =>
      ['compaction_started', 'compaction_ended'].includes(event.type) ||
      ['PreCompact', 'PostCompact'].includes(event.hook_event_name))) {
      const key = event.eventId ?? `${event.hook_event_name}:${event.receivedAt}`;
      if (handled.has(key)) continue;
      const result = await recordLifecycle(project, row, { ...event, eventId: key }, { locate: false });
      if (result?.status === 'recorded') {
        handled.add(key);
        job.compactions = [...handled];
        save(job);
      }
    }
  }

  async function refresh(mail) {
    for (const job of jobs.values()) {
      const addr = job.row.addr;
      try {
        let row = rowFor(addr);
        if (!row || row.endedAt === null) {
          if (job.pipeRecovery?.exhausted && !job.stopping) continue;
          if (!restored.has(addr) || job.stopping) {
            if (retryAt.get(addr) > Date.now()) continue;
            row = await activate(job, mail);
            retryAt.delete(addr);
          }
          if (row.endedAt === null && row.backend === 'tui') row = await refreshTui(job, row);
          if (row.endedAt === null && row.backend === 'headless') {
            const runtime = running.get(addr);
            try { await runtime.pull?.(); }
            catch (error) {
              running.delete(addr);
              restored.delete(addr);
              recordPipeRecovery(job);
              throw error;
            }
            if (job.pipeRecovery) {
              delete job.pipeRecovery;
              save(job);
            }
            const transcript = await getOarTranscript(runtime, row);
            if (row.transcriptPath !== transcript && transcript) row = index.update(addr, { transcriptPath: transcript });
            await refreshOpenCodeProof(runtime, row);
            const exit = runtime.rows.findLast(event => ['exited', 'released'].includes(event.type) && event.streamId === runtime.streamId);
            if (exit || runtime.endedAt != null) {
              try { if (!runtime.hosted) await disposeSession(runtime.session); }
              catch (error) { report(`${addr} dispose: ${error.message}`); }
              finally { runtime.unsubscribe?.(); running.delete(addr); }
              row = await finish(job, row, exit?.at ?? runtime.endedAt);
            }
          }
        }
        if (row.endedAt !== null && !job.endRecorded) await finish(job, row);
        await retainCompaction(job, row);
      } catch (error) {
        if (!(retryAt.get(addr) > Date.now())) {
          report(`${addr} recovery: ${error.message}`);
          retryAt.set(addr, Date.now() + 10_000);
        }
      }
    }
  }

  async function stop(row) {
    requireLive(row);
    const job = jobs.get(row.addr);
    if (!job) throw new ErrorCode('not-found', 'Session is not managed by this daemon');
    job.stopping = true;
    save(job);
    let runtime = running.get(row.addr);
    let endedAt;
    if (row.backend === 'headless') {
      if (!runtime && job.host) runtime = await attachHeadless(row, job, { stop: true });
      if (runtime?.hosted) endedAt = (await runtime.close()).endedAt;
      else if (runtime?.session) await disposeSession(runtime.session);
      else endedAt = runtime?.endedAt;
      runtime?.unsubscribe?.();
      running.delete(row.addr);
    } else if (row.backend === 'tui') {
      const terminal = await getPane(job, row);
      if (terminal && !completedPane(terminal)) await callHc('kill', terminal.address);
      const closed = terminal && await getPane(job, row);
      if (closed && !completedPane(closed)) throw new ErrorCode('not-ready', 'hc has not confirmed pane exit');
      endedAt = closed?.finished_ms;
    }
    if (row.backend === 'tui' && row.pane) row = await refreshTui(job, row);
    return finish(job, row, endedAt);
  }

  async function shutdown() {
    holders.clear();
    await Promise.allSettled([...running.entries()].filter(([, runtime]) => runtime.unsubscribe).map(async ([addr, runtime]) => {
      try {
        runtime.suspend();
        await disposeSession(runtime.session);
      } catch (error) { report(`${addr}: ${error.message}`); }
      finally { runtime.unsubscribe(); }
    }));
  }

  async function upgradeSessions() {
    return Promise.all(rows().filter(row => row.endedAt === null).map(async row => {
      const { addr, backend, sessionId, pane } = row;
      const base = { addr, backend, sessionId, pane };
      const job = jobs.get(addr);
      try {
        if (!job) throw new Error('Session has no daemon ownership record');
        if (backend === 'headless') {
          const host = running.get(addr);
          if (!host?.hosted) throw new Error('Session has no attached detached host');
          await host.pull();
          if (host.error()) throw new Error(host.error());
          if (host.transport === pipeTransport) {
            const snapshot = await host.snapshot();
            if (snapshot.ended || sessionId !== host.session.id || host.endedAt != null) throw new Error('Codex pipe session changed');
            return { ...base, status: 'attached', transport: host.transport, incarnation: host.incarnation, streamId: host.streamId,
              pid: host.pid, childPid: snapshot.childPid, holderGeneration: String(snapshot.generation), protocol: 3, release: host.build() };
          }
          return { ...base, status: 'attached', incarnation: host.incarnation, streamId: host.streamId,
            pid: host.pid, protocol: host.protocol, release: host.release, oar: host.oar };
        }
        const terminal = await getPane(job, row);
        if (!terminal || completedPane(terminal)) throw new Error('Owned pane is unavailable');
        const binding = job.tui;
        let protocol = null;
        if (binding?.transport === 'loom-pty') {
          ({ protocol } = await controlHello(binding.socket, binding.incarnation));
          const state = await requestControl(binding.socket, 'state', {}, binding.incarnation, protocol || undefined);
          if (row.sessionId && state.native?.sessionId && state.native.sessionId !== row.sessionId) {
            throw new Error('loom-pty native session identity changed');
          }
        } else if (binding?.transport === 'holder-v3') {
          protocol = 3;
          const { terminal: native, session } = await holders.attach(job, row, terminal);
          const state = await session.readState({ passive: true });
          if (state.exit || state.native.identityChanged || row.sessionId && state.native.sessionId !== row.sessionId) {
            throw new Error('Holder native session identity changed');
          }
          const snapshot = await native.client.hello();
          return { ...base, status: 'attached', protocol, transport: binding.transport, incarnation: binding.incarnation,
            release: binding.holderRelease.root, pid: terminal.pid, paneCreatedAt: terminal.created_ms, childPid: snapshot.childPid,
            holderGeneration: String(snapshot.generation) };
        }
        return { ...base, status: 'attached', transport: binding?.transport, incarnation: binding?.incarnation, release: job.release,
          pid: terminal.pid, protocol };
      } catch (error) {
        return { ...base, status: 'unavailable', reason: error.message };
      }
    }));
  }

  async function upgradeHolder({ target, rollback, check, addr }) {
    const row = rowFor(addr);
    const job = row && jobs.get(row.addr);
    if (!job || row.endedAt !== null || job.tui?.transport !== 'holder-v3' && job.host?.transport !== pipeTransport) {
      throw new ErrorCode('not-ready', 'Choose a live holder v3 session address');
    }
    if (!rollback && !isAbsolute(target ?? '')) throw new ErrorCode('invalid-arguments', 'Holder release path must be absolute');
    target = rollback ? undefined : realpathSync(target);
    if (job.host?.transport === pipeTransport) {
      const runtime = running.get(row.addr);
      if (runtime?.transport !== pipeTransport || runtime.endedAt != null || runtime.error()) {
        throw new ErrorCode('not-ready', 'Owned Codex pipe holder is unavailable');
      }
      return runtime.handoff({ target, rollback, check });
    }
    const status = () => getPane(job, row);
    const pane = await status();
    if (!pane || completedPane(pane)) throw new ErrorCode('not-ready', 'Owned holder pane is unavailable');
    return holders.handoff(job, row, pane, status, target, rollback, check);
  }

  async function sealed(addr, gate) {
    const row = addr && rowFor(addr);
    if (!row || row.endedAt !== null || !gate) return true;
    const snapshot = await transport.inspect(targetBinding(row)).catch(() => undefined);
    return Boolean(snapshot && (snapshot.state === 'finished' || transport.turnEnd(gate, snapshot)));
  }

  function lastActivity(row, event) {
    return Math.max(row.startedAt, event?.at ?? event?.receivedAt ?? 0, activity.get(row.addr) ?? 0,
      row.backend === 'headless' ? running.get(row.addr)?.session.status().value.lastEventAt ?? 0 : 0);
  }

  return { rows, rowFor, events, targetBinding, transport, requestedMode, canInterrupt, resolve, requireLive, newJob,
    activate, failSpawn, runtimeSelection, refresh, stop, shutdown, upgradeSessions, upgradeHolder, jobs, managedHc, sealed, lastActivity,
    routeParent, bindSuccessor, retirePredecessor, successorOf, rememberUserPrompt };
}
