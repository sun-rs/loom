import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { CommandError as ErrorCode, resolveTarget } from '../cli/sessions.mjs';
import { runtimeDirectory } from '../cli/project.mjs';
import { roles, rotatingRoles } from '../index/index.mjs';
import { hc, hcAt, tui, addressPattern } from '../inbox/tui.mjs';
import { wireText } from '../inbox/message.mjs';
import { recordLifecycle } from '../handover/index.mjs';
import { generateBrief } from '../handover/brief.mjs';
import { extractOutstanding } from '../handover/outstanding.mjs';
import { replyForDelivery } from '../inbox/reply-file.mjs';
import { eventPath, jsonRows, readText, syncDirectory, writeState } from './io.mjs';
import { bindOarTranscript, checkedTranscript, oarControl, oarDelivery, oarEnd, oarSnapshot, trackOar } from './oar.mjs';
import { managedHookPath, openCodeExport, openTui, ownedPane, refreshOpenCode } from './tui.mjs';
import { tuiHolders } from './tui-holder.mjs';
import { recoverCodexEnd, recoverNativeDelivery } from './recovery.mjs';
import { claudeAuthMode, spawnProfile, enforceDeny, readPolicy } from '../cli/policy.mjs';
import { headAt, linkTuiInputHead, observeTuiHeads, saveTuiInputHead } from './turn-heads.mjs';
import { controlTui, wrapperFailedStart } from '../runtimes/tui/transport.mjs';
import { controlHello, requestControl } from '../tui/pty-control.mjs';
import { attachHost } from './host-client.mjs';
import { attachCodexHolder, pipeTransport, useCodexHolder } from './codex-holder.mjs';
import { managedCliPath, releaseId, releaseRoot, upgradeState } from './release.mjs';
import { projectMemoryPrompt, workerMemoryPrompt } from '../memory/project.mjs';
import { disposeSession } from './session-close.mjs';
import { workerEnvironment } from './worker-environment.mjs';
import { withClaudeTranscriptStops } from '../relay/sources.mjs';
import { rotationReasonText } from './rotation-policy.mjs';
import { visibleRoles } from './herdr-layout.mjs';
import { idleForRelease, isReleased, isThresholdRetirement, workerIdleSince } from './worker-retention.mjs';
import { projectSessionMemory } from './processes.mjs';
import { workerCheckpoint, workerCheckpointMismatch, workerCheckpointText, writeWorkerHandoff } from './worker-handoff.mjs';
import { requestedWorkerTier, storedWorkerTier } from '../lib/worker-tiers.mjs';
import { recordHostEvidence } from '../evidence/host.mjs';
import { accountCollector } from './account-collection.mjs';

const runtimeIds = { codex: 'codex', agy: 'antigravity', claude: 'claude', opencode: 'opencode' };
const modes = new Set(['tui', 'headless']);
const guardedAbort = new Set(['codex', 'agy', 'opencode']);
export const opencodeExportFailureLimit = 3;
const pipeRecoveryLimit = 4;
const pipeRecoveryWindow = 120_000;
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const temporaryRole = role => role === 'worker' || role === 'reviewer'; // Old ledgers may still contain retired sessions.
export const validInput = text => hasText(text) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text);
export const validDispatchReason = value => value === undefined ||
  validInput(value) && !/[\r\n]/.test(value) && Buffer.byteLength(value) <= 512;
const unattended = 'No human is watching this session. Never ask the user interactively or open a native question. For a decision, write the facts, options and recommendation in a file. Run "$LOOM_BIN" notifications --needs-decision TEXT --kind decision with a short summary and the file path. Continue any independent work, then end the turn with BLOCKED <decision> while the decision is pending. The answer arrives as a normal delivery.';
const leaderGuidance = 'Make decisions. Split work into cards, dispatch Workers, review their receipts and evidence summaries, and choose the next action. Use loom status, loom hist summaries and git diff --stat. Delegate source and test inspection, diagnosis, integration, merging and test/build execution to Workers. An integration Worker supplies fixed-candidate and full-suite evidence. Forward any Auditor-commissioned findings verbatim with loom send and the reply file path. Pack Worker evidence with loom gate pack and use loom escalate for confirmed red facts. End the turn while waiting for deliveries.';
const leaderWorkerGuidance = [
  'Keep one Worker through the card, including resumed work and local R1/R2 fixes that preserve interfaces.',
  'Use send --next-card only for an adjacent small card in the same area and worktree, with at most 60% context used and one compaction by default, and no verified fact errors or overreach on the preceding card.',
  'After compaction, switch at a step boundary with a handoff sheet when remaining context falls below 15% again.',
  'Use worker-handoff <Worker> after 10 minutes without progress, or give --reason fabrication|overreach and --evidence for a confirmed finding.',
  'Use a fresh Worker plus an exact RED reproduction for a changed area, rejected direction, R3, fabrication or overreach.',
  'New Workers verify branch, base SHA, WIP lines and active rulings before editing. Rotate resident roles at a card boundary after the first compaction. State the dispatch choice with --reason.',
].join(' ');
const seniorGuidance = 'Use .project notes and evidence. For card preparation, keep targeted source reads to 200 lines. If a heavy tool is essential after a denial, paste the denial receipt’s "$LOOM_BIN" senior-tool --retry DENY-ID --reason "short sentence" line and state why the tool is essential. Loom keeps the output tail and records the reason. When workers or delivery are unavailable, Loom can authorize the same command without a reason.';
const cardConventions = row => [
  '## Loom task conventions',
  `Task ${row.task}, working directory ${row.cwd}. Follow the card’s writable scope and acceptance commands. Start with the card and skip environment exploration or searches for AGENTS.md and skills to discover Loom conventions.`,
  'Invoke Loom commands through "$LOOM_BIN", the absolute executable path.',
  'Before editing, run "$LOOM_BIN" worker-check. Confirm its branch, base SHA, WIP line counts and active rulings in your first report. If verification fails, stop work and report BLOCKED with the mismatch.',
  'After a completed compaction, if context remaining falls below 15% again by default, finish the current step and run "$LOOM_BIN" worker-handoff --wip TEXT --passed TEXT --pending TEXT. Report BLOCKED with the handoff sheet path.',
  unattended,
  'Keep Git hooks enabled. Git --no-verify, core.hooksPath overrides, and equivalent bypasses are forbidden.',
  ...(row.integration ? ['Integration profile: use the private $TMPDIR for temporary test artifacts and `ps` on PATH or $LOOM_TEST_PS for process listing. Run the card’s full-suite command directly and leave its exit status visible. Report the candidate SHA, command, exit code and totals in the result so Loom can record the evidence card. Put any full log in the card worktree or its private temporary directory. Do not write project .project summaries.'] : []),
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
  open, exportOpenCode, openPane = openTui, getPane = ownedPane, callHc = hc, controller, layout, capabilities, hostGrants,
  observeAccounts, observeAccountDiagnostics, observeAccountIncidents, accountBinding, accountStatusline,
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
  const unknownLiveness = new Set();
  const openCodeProofs = new Map();
  const rows = addr => index.query(addr ? { addr } : {});
  const rowFor = addr => addr ? rows(addr)[0] : undefined;
  const liveCaller = addr => {
    const row = rowFor(addr);
    const job = jobs.get(addr);
    if (job && restored.has(addr) && row?.endedAt === null && roles.includes(row.role) && !job.stopping && !isReleased(job) &&
        !awaitingBrief(job) && routeParent(addr)?.addr === addr) return row;
  };
  const file = addr => join(path, `${addr}.json`);
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (!entry.isFile() || !/^(?:loom|oar)-[0-9a-f-]{36}\.json$/.test(entry.name)) continue;
    const job = JSON.parse(readText(join(path, entry.name)));
    if (file(job.row.addr) !== join(path, entry.name) || !within(project, job.row.cwd)) throw new Error('Invalid stored session');
    jobs.set(job.row.addr, job);
  }
  const save = job => writeState(file(job.row.addr), JSON.stringify(job) + '\n');
  const { accountOptions, accountCallbacks, reserveStatusline, refreshAccounts, clear: clearAccounts } =
    accountCollector(project, { jobs, save, report, events: addr => events(addr), accountBinding,
      observeAccounts, observeAccountDiagnostics, observeAccountIncidents });

  function legacySessions() {
    return rows().filter(row => row.endedAt === null && roles.includes(row.role) && jobs.has(row.addr) && !jobs.get(row.addr).stopping &&
      !capabilities?.hasSession(row.addr));
  }

  async function legacyPeerCaller(ancestors, eligible) {
    if (!ancestors.length) return;
    const chain = new Map(ancestors.map(process => [process.pid, process]));
    const matches = [];
    for (const addr of eligible) {
      const job = jobs.get(addr);
      if (!job) continue;
      const runtime = running.get(addr);
      const host = runtime?.identity ?? job.host?.identity;
      const pane = job.paneBinding;
      const proof = chain.get(host?.pid ?? pane?.pid);
      const child = job.host?.childPid ?? job.tui?.childPid;
      if (!proof || child && chain.get(child)?.parent !== proof.pid || capabilities?.hasSession(addr)) continue;
      const actor = liveCaller(addr);
      if (!actor) continue;
      if (job.legacyPeer) {
        if (job.legacyPeer.pid !== proof.pid || job.legacyPeer.birth !== proof.birth) continue;
      } else if (host) {
        if (!runtime?.hosted || runtime.endedAt != null || Math.floor(proof.startedAt / 1000) !==
            Math.floor(Date.parse(host.started) / 1000)) continue;
      } else {
        // hc's original creation clock is the only persisted start evidence in
        // old pane records. Confirm that pane before pinning the kernel birth.
        if (!Number.isFinite(pane.createdAt) || Math.abs(pane.createdAt - proof.startedAt) > 5000) continue;
        const terminal = await getPane(job, actor).catch(() => undefined);
        if (terminal?.state !== 'live' || terminal.pid !== pane.pid || terminal.created_ms !== pane.createdAt) continue;
      }
      matches.push({ actor, job, proof });
    }
    if (matches.length !== 1) return;
    const { actor, job, proof } = matches[0];
    if (!job.legacyPeer) {
      job.legacyPeer = { pid: proof.pid, birth: proof.birth };
      try { save(job); }
      catch (error) { delete job.legacyPeer; throw error; }
    }
    return actor;
  }

  function saveLaunchPaths(job) {
    if (job.launchPaths) return;
    const { backend, cli } = job.row;
    job.launchPaths = { cli: managedCliPath(project), release: releaseRoot,
      ...(backend === 'tui' && { hook: cli === 'opencode' ? join(releaseRoot, 'adapters', 'opencode', 'prompt-events') : managedHookPath(project, cli) }) };
    save(job);
  }
  function pathWarnings(row) {
    const job = jobs.get(row.addr);
    if (!job) return [];
    const launch = job.launchPaths;
    if (launch) return [
      ...(launch.cli && launch.cli !== managedCliPath(project) ? [{ kind: 'cli', path: launch.cli,
        reason: 'LOOM_BIN is pinned. Existing sessions cannot pick up new commands such as gate/escalate through upgrades. Use a successor.' }] : []),
      ...(launch.hook && launch.release && within(launch.release, launch.hook) && launch.release !== releaseRoot ?
        [{ kind: 'hook', path: launch.hook, reason: 'Hook is pinned to an older Loom release' }] : []),
    ];
    const upgrade = upgradeState(project);
    if (upgrade?.phase !== 'committed' || row.startedAt >= upgrade.finishedAt) return [];
    const shimBorn = row.cli === 'claude' && statSync(join(runtimeDirectory(project), 'hook.mjs'), { throwIfNoEntry: false })?.birthtimeMs;
    return [{ kind: 'cli', reason: 'Session uses a legacy CLI path. Existing LOOM_BIN cannot pick up gate/escalate through upgrades. Use a successor.' },
      ...(row.backend === 'tui' && !(shimBorn && shimBorn <= row.startedAt) ? [
        { kind: 'hook', reason: 'Session predates the serving release and uses a legacy hook path' },
      ] : [])];
  }
  const holders = tuiHolders(project, controller, save);
  const events = addr => running.get(addr)?.rows ?? jsonRows(readText(eventPath(project, addr)));
  const transportReceipt = metadata => metadata && { transport: metadata.transport, reason: metadata.reason };
  const bound = (row, extra = {}) => ({ addr: row.addr, cwd: row.cwd, provider: row.cli,
    createdAt: row.startedAt, backend: row.backend, ...extra });
  const terminalCall = (job, ...args) => job.herdr && callHc === hc ? hcAt(job.herdr.hcCommand, ...args) : callHc(...args);

  async function managedHc(command, addr, ...args) {
    const job = jobs.get(addr);
    const row = job && rowFor(addr);
    if (!row || !row.pane) throw Object.assign(new Error(`No owned pane for ${addr}`), { kind: 'not_found' });
    const terminal = await terminalCall(job, 'get', row.pane);
    if (terminal.address !== row.pane || terminal.created_ms !== job.paneBinding?.createdAt ||
        terminal.pid !== job.paneBinding?.pid || realpathSync(terminal.cwd) !== row.cwd) throw new Error('hc pane identity changed');
    if (command === 'get') return { ...terminal, address: addr, labels: { ...terminal.labels, 'loom-cli': row.cli } };
    return terminalCall(job, command, row.pane, ...args);
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
        const retention = jobs.get(target.addr)?.retention;
        return { ...snapshot, ...(row?.endedAt === null && retention?.releasedAt != null &&
          { state: retention.resuming ? 'resuming' : 'released' }), ...(row?.endedAt === null && runtime?.stuck &&
          { state: 'stuck', reason: runtime.stuck.reason }), ...(row?.endedAt === null && jobs.get(row.addr)?.pipeRecovery?.exhausted &&
          { state: 'stuck', reason: 'codex-resume-exhausted' }),
          ...(row?.endedAt === null && unknownLiveness.has(row.addr) && { state: 'stuck', reason: 'liveness-unknown' }),
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

  function rememberLiveness(addr, result) {
    const job = jobs.get(addr);
    if (!job || !result) return;
    const { health, screenFailure, lastProgressAt } = result;
    const persisted = health && { ...health };
    if (persisted) delete persisted.zeroProgressMs;
    const previous = job.liveness;
    if (JSON.stringify([previous?.health, previous?.screenFailure]) === JSON.stringify([persisted, screenFailure])) return;
    job.liveness = { health: persisted, screenFailure, lastProgressAt, observedAt: result.observedAt };
    save(job);
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

  async function finish(job, row, at = Date.now(), exit) {
    if (exit && !job.stopping && !job.exit) {
      const code = exit.code ?? exit.exit_code ?? exit.exitCode;
      job.exit = { status: 'exited', since: Math.max(row.startedAt, at), code: Number.isSafeInteger(code) ? code : null,
        reason: `Native CLI exited${Number.isSafeInteger(code) ? ` with code ${code}` : ' (exit code unavailable)'}` };
      save(job);
    }
    openCodeProofs.delete(row.addr);
    clearAccounts(row.addr);
    holders.detach(job.tui);
    if (row.endedAt === null) {
      try { capabilities?.revokeSession(row.addr); }
      catch (error) { report(`Could not remove finished session capability for ${row.addr}: ${error.code ?? 'filesystem error'}`); }
    }
    const final = row.endedAt === null ? index.update(row.addr, { endedAt: Math.max(row.startedAt, at) }) : row;
    if (job.hostGrant && !job.hostEvidencePath) {
      const evidence = await recordHostEvidence(project, final, job.hostGrant, events(row.addr));
      job.hostEvidencePath = evidence.path;
      save(job);
    }
    try { layout?.clear(final); }
    catch (error) { report(`Herdr layout ${row.addr}: ${error.message}`); }
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

  const awaitingBrief = job => job?.handoverAck && !job.handoverBound && !job.stopping && !job.handoverFailure;

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
      candidate.startedAt > current.startedAt && candidate.endedAt === null && restored.has(candidate.addr) &&
      !awaitingBrief(jobs.get(candidate.addr)) && !jobs.get(candidate.addr)?.stopping &&
      !jobs.get(candidate.addr)?.handoverFailure) ?? live ?? current;
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
    if (!old || !job || job.handoverFailure || !restored.has(row.addr) || temporaryRole(old.role) || old.role !== row.role ||
        old.project !== row.project || !(old.startedAt < row.startedAt) || row.endedAt !== null ||
        job.handoverFrom && job.handoverFrom !== old.addr ||
        beforeBind && awaitingBrief(job) ||
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

  function finalizeV2(job) {
    if (!job.rotationV2Finalized) {
      job.rotationV2Finalized = true;
      try { save(job); }
      catch (error) { delete job.rotationV2Finalized; throw error; }
    }
  }

  async function retirePredecessor(job) {
    if (!job.handoverBound || job.rotationV2 && !job.rotationV2Finalized) return;
    const old = rowFor(job.handoverFrom);
    if (job.herdr && !job.herdrPublished) {
      const row = rowFor(job.row.addr);
      const terminal = await getPane(job, row);
      if (!terminal || completedPane(terminal)) throw new ErrorCode('not-ready', 'Herdr successor is no longer live');
      await layout?.publish(row, terminal);
      job.herdrPublished = true;
      save(job);
    }
    if (old?.endedAt !== null || !jobs.has(old.addr)) return;
    const successor = routeParent(old.addr);
    if (successor.addr === old.addr || successor.endedAt !== null) return;
    return stop(old);
  }

  function resolve(target, caller, { latestTask = false } = {}) {
    const sessions = rows();
    const actor = caller && sessions.find(row => row.pane === caller || row.addr === caller);
    const exact = sessions.find(row => row.pane === target || row.addr === target);
    if (exact) return exact;
    if (latestTask && !roles.includes(target)) {
      const attempts = sessions.filter(row => row.role === 'worker' && row.task === target && (!actor || actor.project === row.project));
      if (attempts.length && new Set(attempts.map(row => row.project)).size === 1) return attempts.at(-1);
    }
    if (!rotatingRoles.includes(target) && target !== 'super') return resolveTarget(sessions, target, actor?.addr);
    const live = sessions.filter(row => row.role === target && row.endedAt === null && (!actor || actor.project === row.project) &&
      !awaitingBrief(jobs.get(row.addr)) && !jobs.get(row.addr)?.stopping && !jobs.get(row.addr)?.handoverFailure &&
      routeParent(row.addr)?.addr === row.addr);
    if (!live.length) throw new ErrorCode('not-found', `No live session matches ${target}`);
    if (live.length > 1) throw new ErrorCode('ambiguous-target', `Multiple live sessions match ${target}: ${live.map(row => row.addr).join(', ')}`);
    return live[0];
  }

  async function newJob(input, caller, checkBarrier, occupies, handoverState, selfHandoff) {
    if (!roles.includes(input.role) || !hasText(input.cwd) || !validInput(input.prompt) ||
        (input.parent !== undefined && !hasText(input.parent)) ||
        (input['trust-workspace'] !== undefined && typeof input['trust-workspace'] !== 'boolean') ||
        (input['expect-red'] !== undefined && (input.role !== 'worker' || typeof input['expect-red'] !== 'boolean')) ||
        (input.integration !== undefined && (input.role !== 'worker' || typeof input.integration !== 'boolean')) ||
        (input['keep-warm'] !== undefined && (input.role !== 'worker' || typeof input['keep-warm'] !== 'boolean')) ||
        (input.reason !== undefined && (input.role !== 'worker' || !validDispatchReason(input.reason))) ||
        (input.tier !== undefined && input.role !== 'worker') ||
        (input.cli !== undefined && !Object.hasOwn(runtimeIds, input.cli)) ||
        (input.mode !== undefined && !modes.has(input.mode)) ||
        (input.defaultMode !== undefined && !modes.has(input.defaultMode)) ||
        (input.deliver !== undefined || input.barrier !== undefined) &&
          (input.role !== 'worker' || !['stream', 'barrier'].includes(input.deliver) ||
            (input.deliver === 'barrier' ? !addressPattern.test(input.barrier ?? '') : input.barrier !== undefined)) ||
        ['model', 'effort'].some(key => input[key] !== undefined && !hasText(input[key])) ||
        (input.role === 'worker' || input.task !== undefined) && !addressPattern.test(input.task ?? '') ||
        (input.role === 'worker' || input.wave !== undefined) && !addressPattern.test(input.wave ?? '')) {
      throw new ErrorCode('invalid-arguments', 'spawn requires role, cwd and prompt. Workers require task and wave. Barrier delivery requires a set ID.');
    }
    const workerTier = input.role === 'worker' ? requestedWorkerTier(input) : undefined;
    const integration = workerTier === 'integration';
    const cwd = inProjectDirectory(project, input.cwd);
    const predecessor = input['handover-from'] && rowFor(input['handover-from']);
    if (input['handover-from'] !== undefined && (!predecessor || !jobs.has(predecessor.addr) ||
        temporaryRole(input.role) || predecessor.role !== input.role ||
        input.parent && input.parent !== predecessor.addr || successorOf(predecessor.addr))) {
      throw new ErrorCode('invalid-arguments', '--handover-from requires an unreplaced managed address of the same resident role');
    }
    const actor = caller && rows().find(row => row.pane === caller || row.addr === caller);
    const parent = predecessor ?? (input.parent ? resolve(input.parent, caller) : actor);
    if (input.role === 'worker' && actor?.role === 'leader' && parent?.addr !== actor.addr) {
      throw new ErrorCode('forbidden', 'Leader must be the parent of its Workers');
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
    const { requested, selected, deny, warnings, fastRequested, trustWorkspace } = spawnProfile(project,
      input.role === 'worker' ? { ...input, workerCaller: caller ?? null } : input, addr => routeParent(addr)?.addr, occupies);
    const { cli, mode, model, effort } = selected;
    if ((integration || workerTier === 'host') && mode !== 'headless') {
      throw new ErrorCode('invalid-arguments', `The ${workerTier} tier requires a headless Worker`);
    }
    if (workerTier === 'host' && input['keep-warm']) throw new ErrorCode('invalid-arguments', 'Host grants are limited to a card and cannot keep a Worker warm');
    if (input['keep-warm'] && mode !== 'headless') throw new ErrorCode('invalid-arguments', '--keep-warm requires a headless worker');
    const addr = `${mode === 'headless' ? 'oar' : 'loom'}-${randomUUID()}`;
    const runtimeId = mode === 'tui' ? `${cli}-tui` : runtimeIds[cli];
    const row = { addr, role: input.role, project: name, task: input.task, wave: input.wave,
      backend: mode, runtimeId, cli, model, effort, cwd, baseCommit: gitHead(cwd), parent: parent?.addr ?? null,
      startedAt: [...jobs.values()].reduce((at, job) => Math.max(at, job.row.startedAt + 1), Date.now()) };
    const herdr = mode === 'tui' && visibleRoles.includes(row.role) ? await layout?.placement(row) : undefined;
    if (herdr && !predecessor && rows().some(old => old.role === row.role && old.endedAt === null)) {
      throw new ErrorCode('invalid-arguments', `A live ${row.role} already occupies its slot. Supply --handover-from.`);
    }
    let prompt = input.prompt;
    let handoverAck;
    let compactHandover;
    let handoverItems;
    if (predecessor) {
      const { brief } = await generateBrief({ role: input.role, project: name, projectDir: project, from: predecessor.addr,
        index, locate: false });
      if (rotatingRoles.includes(input.role)) {
        handoverAck = `HANDOVER-ACK ${randomUUID()}`;
        const state = input.role === 'leader' || selfHandoff ? `\n\n${handoverState(predecessor)}` : '';
        const note = extractOutstanding(selfHandoff?.urgent ? undefined : selfHandoff?.note);
        const startup = extractOutstanding(prompt);
        handoverItems = [...new Set([...note.items, ...startup.items])];
        const judgment = selfHandoff && !selfHandoff.urgent ?
          `\n\n## 交班判断\n${selfHandoff.notePath}\n原因：${rotationReasonText(selfHandoff.reason)}\n\n${note.background}` : '';
        const rotationInstructions = selfHandoff?.v2 ?
          '\n\n首轮只核对原件。首行写完整确认码。逐行照抄事实卡的 HEAD、Branch、Base SHA、WIP、Rulings 标签，并报告现查的值。若发现不一致，第二行写 MISMATCH，列明差异后结束。接管生效通知到达后执行 Next action。' : '';
        const outstanding = handoverItems.length ? handoverItems.map(item => '- ' + item).join('\n') : '无';
        const complete = `## Do now\n${outstanding}\n\n${brief.trimEnd()}${state}${judgment}${rotationInstructions}${selfHandoff?.facts ? '\n\n' + selfHandoff.facts : ''}\n\n## 启动指令\n${startup.background}\n\n## 交接确认\n${handoverAck}\n`;
        compactHandover = mode === 'tui';
        prompt = compactHandover ? complete :
          `Complete the ${input.role === 'leader' ? 'Leader' : 'Auditor'} handover in this first native turn. ${replyForDelivery(project, complete, 0)}. Resolve the path from ${project}. Read the full file through its final acknowledgement line, then copy that line exactly onto the first line of your final reply. Include the current SHA and relevant paths you verified. This first turn is for verification. Follow the report format in the briefing. When Loom sends 接管生效, start the Do now items.` +
          (row.role === 'leader' ? '\n\n' + leaderWorkerGuidance : '');
      } else {
        prompt = `先读前任简报及任务指定的交接记录，再开始接管。\n\n${brief.trimEnd()}\n\n## 启动指令\n${prompt}`;
      }
    }
    if (row.role === 'leader' || row.role === 'auditor') {
      const guidance = row.role === 'leader' ? leaderGuidance + ' ' + leaderWorkerGuidance :
        'Decide the gate verdict from the packet, fixed SHA, and integration Worker evidence. Ask for the integration Worker evidence if it is missing. Delegate investigation, tests, builds, merges and integration. At phase boundaries, inspect the deterministic checks and Worker evidence. Select one evidence command for a Worker to reproduce and record review-only findings with loom audit-findings. Wake sources are user or Super messages, a gate packet or red escalation from Leader, succession supervision, and replies you explicitly requested.';
      prompt = `## Loom role guidance\n${guidance} ${seniorGuidance} Do not wait on background Bash or poll loom state. ${unattended} If a result is overdue, run "$LOOM_BIN" status and check stalled deliveries and suppressed replies. At a rotation signal, write your judgment and in-flight card IDs to the indicated note, run "$LOOM_BIN" rotate --self, and finish the current turn. Loom starts the same profile at idle. For v2, one failed handover stops rotation for this phase and Loom informs Super. Put DONE, BLOCKED, FAILED, PASS, REJECT or APPROVE on the first line of the final conclusion, before any preamble. The handover turn starts with its exact HANDOVER-ACK. Use NOREPLY for acknowledgements.\n\n## Startup request\n${prompt}`;
      try { prompt = await projectMemoryPrompt(project) + prompt; }
      catch (error) { report(`Project memory unavailable: ${error.message}`); }
    }
    if (compactHandover) {
      // Keep a fresh TUI's startup wire within a single holder chunk.
      const pointer = replyForDelivery(project, prompt, 0);
      prompt = `${pointer} relative to $LOOM_PROJECT. Read the briefing. Start your reply with its exact HANDOVER-ACK, then verify the SHAs and paths in its format. For v2, report differences on line two with MISMATCH and stop. When Loom sends 接管生效, follow Do now and Next action.`;
    }
    let checkpoint;
    if (row.role === 'worker') {
      const card = `${row.task}\n${input.prompt}`;
      checkpoint = await workerCheckpoint(project, row, card);
      let memory;
      try { memory = workerMemoryPrompt(project, card); }
      catch (error) { report(`Worker memory unavailable: ${error.message}`); }
      prompt = [prompt, cardConventions({ ...row, integration }),
        '## Loom dispatch baseline\n' + workerCheckpointText(checkpoint), memory].filter(Boolean).join('\n\n');
    }
    const fast = selfHandoff?.inheritFast ? jobs.get(predecessor.addr)?.fast : selected.fast;
    const requestedFast = selfHandoff?.inheritFast ? jobs.get(predecessor.addr)?.fastRequested : fastRequested;
    const job = { row, firstId: randomUUID(), prompt, gate, requested, deny, release: releaseId(),
      ...(actor && jobs.has(actor.addr) && { sender: targetBinding(actor) }),
      ...(row.role === 'worker' && { isolatedWorkerHome: workerTier !== 'host', workerTier }),
      ...(input['keep-warm'] && { retention: { keepWarm: true } }),
      ...(integration && { integration: true }),
      ...(cli === 'claude' && mode === 'tui' && { autoTrustWorkspace: input['trust-workspace'] ??
        (trustWorkspace && defaultTrustWorkspace(project, cwd)) }),
      ...(warnings.length && { warnings }),
      ...(requestedFast !== undefined && { fastRequested: requestedFast }),
      ...(fast !== undefined && { fast }),
      ...(predecessor && { handoverFrom: predecessor.addr,
        rotationReason: selfHandoff?.reason ?? (input.profileChoice !== undefined ? 'switch' : 'handover') }),
      ...(herdr && { herdr }),
      ...(handoverAck && { handoverAck }),
      ...(handoverItems?.length && { handoverItems }),
      ...(selfHandoff && { selfRotationId: selfHandoff.id }),
      ...(selfHandoff?.v2 && { rotationV2: true, rotationPhase: selfHandoff.phase, rotationFacts: selfHandoff.expectedFacts,
        ...(selfHandoff.noteReview && { rotationNoteReview: selfHandoff.noteReview }) }),
      ...(compactHandover && { compactHandover }),
      ...(row.role === 'worker' && { cardStart: headAt(cwd), card: input.prompt, checkpoint }),
      ...(input['expect-red'] !== undefined && { expectRed: input['expect-red'] }),
      ...(deliver && { deliver, ...(input.barrier && { barrier: input.barrier }) }),
      ...(cli === 'opencode' && mode === 'tui' && { plannedNativeId: `ses_${randomUUID().replaceAll('-', '')}` }) };
    if (workerTier === 'host') {
      job.pendingHostGrant = hostGrants.prepare(row, policyAllowsHost(row));
      job.prompt += '\n\nTrusted host grant for this card. Use absolute native CLI paths. Keep credentials, global config, CCP, Solars, rah_os, loom-next and unrelated processes or panes outside the task. Run only the authorized work and end the card with a conclusion.';
    }
    save(job);
    jobs.set(addr, job);
    return job;
  }

  function policyAllowsHost(row) {
    const waves = readPolicy(project, { optional: true }).roles?.worker?.tiers;
    return waves && Object.hasOwn(waves, row.wave) && waves[row.wave] === 'host';
  }

  function authorizeHostLaunch(job) {
    if (!job.pendingHostGrant) return;
    if (job.stopping) throw new ErrorCode('not-ready', 'Host launch was cancelled');
    job.hostGrant = hostGrants.reserve(job.row, policyAllowsHost(job.row), job.pendingHostGrant.id);
    delete job.pendingHostGrant;
    save(job);
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
      const runtime = await (pipe ? attachCodexHolder : attachHost)(project, row, job, save, controller, {
        ...options, capabilities, authorizeLaunch: () => authorizeHostLaunch(job),
      });
      unknownLiveness.delete(row.addr);
      return runtime;
    } catch (error) {
      if (error.code === 'liveness-unknown') unknownLiveness.add(row.addr);
      else if (pipe && !options?.stop) recordPipeRecovery(job);
      throw error;
    }
  }

  async function openFixture(row, job) {
    authorizeHostLaunch(job);
    const session = await open({ ...row, ...(job.fast !== undefined && { fast: job.fast }),
      ...(job.hostGrant && { hostGrant: job.hostGrant }) }, project, row.sessionId,
      capabilities?.ensureSession(row.addr).token);
    try {
      if (row.sessionId && session.id !== row.sessionId) throw new Error('OAR resumed a different native session');
      return trackOar(project, row, session, error => report(error.message), undefined, undefined,
        { ...accountCallbacks, binding: accountOptions({ ...row, sessionId: session.id }) });
    } catch (error) {
      await disposeSession(session).catch(failure => report(failure.message));
      throw error;
    }
  }

  async function activate(job, mail) {
    if (job.handoverFrom && !job.handoverBound && !job.handoverFailure) beginRotation(job, rowFor(job.handoverFrom));
    if (job.handoverBound && rotatingRoles.includes(job.row.role) &&
        !index.rotations().find(item => item.successor === job.row.addr)?.boundAt) {
      beginRotation(job, rowFor(job.handoverFrom));
      index.bindRotation(job.row.addr, job.handoverBoundAt ?? job.row.startedAt);
    }
    let row = rowFor(job.row.addr);
    if (row && row.endedAt !== null) return row;
    if (storedWorkerTier(job) === 'host' && !job.stopping && !job.pendingHostGrant && !hostGrants.active(job.row, job.hostGrant?.id)) {
      if (row) return stop(row);
      throw new ErrorCode('host-grant-expired', 'Host launch requires an active reservation');
    }
    row ??= index.register(job.row);
    if (job.stopping) return stop(row);
    if (isReleased(job) && !job.retention.resuming) return row;
    if (row.backend === 'headless') {
      if (!running.has(row.addr)) {
        const last = events(row.addr).findLast(event => ['stream-opened', 'exited', 'released'].includes(event.type));
        if (!job.host && !job.retention?.resuming && ['exited', 'released'].includes(last?.type) && !last.suspending) {
          return job.retention?.releasing ? released(job, row, last.at) : finish(job, row, last.at);
        }
        if (!job.host && !last) saveLaunchPaths(job);
        const runtime = open ? await openFixture(row, job) : await attachHeadless(row, job);
        if (runtime.endedAt != null) {
          if (job.retention?.resuming) {
            delete job.host;
            delete job.retention.resuming;
            save(job);
            throw new ErrorCode('not-ready', runtime.error ?? 'The native resume process exited during startup');
          }
          if (runtime.sessionId && row.sessionId !== runtime.sessionId) row = index.update(row.addr, { sessionId: runtime.sessionId });
          const transcriptPath = checkedTranscript(runtime.transcriptPath, row);
          await refreshAccounts(job, row, { transcript: transcriptPath, runtime });
          if (transcriptPath && row.transcriptPath !== transcriptPath) row = index.update(row.addr, { transcriptPath });
          return job.retention?.releasing ? released(job, row, runtime.endedAt) : finish(job, row, runtime.endedAt);
        }
        running.set(row.addr, runtime);
        if (runtime.session.id !== row.sessionId) row = index.update(row.addr, { sessionId: runtime.session.id });
      }
      const runtime = running.get(row.addr);
      const transcript = await getOarTranscript(runtime, row).catch(error => report(error.message));
      if (transcript && row.transcriptPath !== transcript) row = index.update(row.addr, { transcriptPath: transcript });
      await refreshAccounts(job, row, { transcript, runtime });
      if (job.retention?.resuming) {
        const { at, warmUntil } = job.retention.resuming;
        (job.revivals ??= []).push({ at, warmUntil, streamId: runtime.streamId });
        job.retention = { ...(job.retention.keep && { keep: true }), ...(job.retention.keepWarm && { keepWarm: true }) };
        save(job);
      }
    } else {
      let terminal = await getPane(job, row);
      let nativeId;
      if (!job.paneBinding && completedPane(terminal) && wrapperFailedStart(job.tui)) {
        job.tui = { transport: 'plain-hc', reason: 'loom-pty-start-failed' };
        save(job);
        terminal = undefined;
      }
      if (!terminal && !job.paneBinding) {
        saveLaunchPaths(job);
        if (row.cli === 'claude') {
          job.authMode = claudeAuthMode(project, row.role);
          save(job);
        }
        reserveStatusline(job, row);
        const opened = await openPane(job, row, project, temporary => {
          job.temporary = temporary;
          save(job);
        }, binding => {
          job.tui = binding;
          save(job);
        }, controller, capabilities?.ensureSession(row.addr).path,
          job.accountStatusline ? accountStatusline?.(row) : undefined);
        terminal = opened.terminal;
        nativeId = opened.nativeId;
      }
      if (!terminal || completedPane(terminal)) return finish(job, row, terminal?.finished_ms, terminal);
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
      if (job.herdr && !job.herdrPlaced && layout) {
        const pending = Boolean(job.handoverFrom && !job.handoverBound);
        await layout.place(row, terminal, pending);
        job.herdrPlaced = true;
        if (!pending) job.herdrPublished = true;
        save(job);
      }
    }
    enforceDeny(runtimeSelection(row).effective, job.deny ?? []);
    if (!mail.messages.some(message => message.id === job.firstId)) {
      mail.enqueue({ id: job.firstId, target: targetBinding(row), createdAt: row.startedAt,
        text: job.prompt, requestedMode: 'queue', mode: 'queue', phase: 'queued', startup: true,
        ...(job.sender && { from: job.sender }),
        ...(row.role === 'worker' && { waveParent: row.parent }) });
    }
    restored.add(row.addr);
    if (job.handoverFrom && !job.handoverBound && !job.handoverAck) bindSuccessor(rowFor(job.handoverFrom), row);
    return row;
  }

  async function failSpawn(job, error) {
    if (error.code === 'liveness-unknown') return;
    job.error = error.message;
    job.stopping = true;
    save(job);
    const row = rowFor(job.row.addr);
    if (row?.endedAt === null) await stop(row).catch(cleanup => report(cleanup.message));
    if (job.handoverFrom && rotatingRoles.includes(job.row.role)) index.failRotation(job.row.addr, Date.now(), error.message);
  }

  function failHandover(job, reason, at) {
    job.handoverFailure = { reason, at };
    save(job);
    index.failRotation(job.row.addr, at, reason);
  }

  function holdsForHandover(message) {
    const { addr } = message.target;
    const job = jobs.get(addr);
    if (!rotatingRoles.includes(job?.row.role)) return false;
    if (awaitingBrief(job)) return message.id !== job.firstId;
    return message.mode === 'queue' && !message.startup && [...jobs.values()].some(candidate =>
      candidate.handoverAck && candidate.handoverFrom === addr &&
      (candidate.handoverBound || awaitingBrief(candidate) && rowFor(candidate.row.addr)?.endedAt === null));
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
    await refreshAccounts(job, row, { transcript: row.transcriptPath, hooks });
    if (!terminal || completedPane(terminal)) {
      let exit = terminal;
      if (job.tui?.exitPath) {
        const recorded = JSON.parse(readText(job.tui.exitPath, 'null'));
        if (recorded && Number.isSafeInteger(recorded.code)) exit = recorded;
      }
      row = await finish(job, row, terminal?.finished_ms, exit ?? {});
    }
    return row;
  }

  async function getOarTranscript(runtime, row) {
    return checkedTranscript(runtime.transcriptPath, row) ?? await bindOarTranscript(runtime.session, row) ??
      (row.cli === 'opencode' ? checkedTranscript(eventPath(project, row.addr)) : null);
  }

  async function refreshOpenCodeProof(runtime, row) {
    if (row.cli !== 'opencode' || !row.sessionId || !runtime.hosted && !exportOpenCode) return;
    const turn = runtime.rows.findLast(event => event.type === 'turn-end' && event.streamId === runtime.streamId && event.unconfirmedBody);
    if (!turn || turn.turnId === openCodeProofs.get(row.addr)?.turnId) return;
    const proof = { turnId: turn.turnId };
    openCodeProofs.set(row.addr, proof);
    try {
      const { events } = exportOpenCode ? await exportOpenCode(row) :
        await openCodeExport(project, row, row.sessionId, { ...process.env, ...workerEnvironment(row) },
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
        if (row?.role === 'reviewer' && row.endedAt === null) {
          await stop(row);
          continue;
        }
        if (!row || row.endedAt === null) {
          if (row && isReleased(job) && (job.closed || row.role !== 'worker')) row = await stop(row);
          if (isReleased(job) && !job.retention.resuming && !job.stopping) continue;
          if (job.pipeRecovery?.exhausted && !job.stopping) continue;
          if (!restored.has(addr) || job.stopping) {
            if (retryAt.get(addr) > Date.now()) continue;
            row = await activate(job, mail);
            retryAt.delete(addr);
          }
          if (row.endedAt === null && row.backend === 'tui') row = await refreshTui(job, row);
          if (row.endedAt === null && !isReleased(job) && row.backend === 'headless') {
            const runtime = running.get(addr);
            try { await runtime.pull?.(); }
            catch (error) {
              running.delete(addr);
              restored.delete(addr);
              if (error.code === 'liveness-unknown') unknownLiveness.add(addr);
              else recordPipeRecovery(job);
              throw error;
            }
            if (job.pipeRecovery) {
              delete job.pipeRecovery;
              save(job);
            }
            const transcript = await getOarTranscript(runtime, row);
            if (row.transcriptPath !== transcript && transcript) row = index.update(addr, { transcriptPath: transcript });
            await refreshAccounts(job, row, { transcript, runtime });
            await refreshOpenCodeProof(runtime, row);
            const exit = runtime.rows.findLast(event => ['exited', 'released'].includes(event.type) && event.streamId === runtime.streamId);
            if (exit || runtime.endedAt != null) {
              try { if (!runtime.hosted) await disposeSession(runtime.session); }
              catch (error) { report(`${addr} dispose: ${error.message}`); }
              finally { runtime.unsubscribe?.(); running.delete(addr); }
              row = job.retention?.releasing ? released(job, row, exit?.at ?? runtime.endedAt) :
                await finish(job, row, exit?.at ?? runtime.endedAt, exit ?? {});
            }
          }
        }
        if (row.endedAt !== null && (!job.endRecorded || job.hostGrant && !job.hostEvidencePath)) await finish(job, row);
        await retainCompaction(job, row);
      } catch (error) {
        if (!(retryAt.get(addr) > Date.now())) {
          report(`${addr} recovery: ${error.message}`);
          retryAt.set(addr, Date.now() + 10_000);
        }
      }
    }
  }

  function setRetention(job, changes) {
    const previous = job.retention;
    const next = { ...previous, ...changes };
    if (JSON.stringify(next) === JSON.stringify(previous)) return;
    job.retention = next;
    try { save(job); }
    catch (error) { job.retention = previous; throw error; }
  }

  async function verifyWorkerStart(job, at, source) {
    if (!job.checkpoint || job.firstReportCheck?.status === 'mismatch' ||
        job.firstReportCheck && (source === 'daemon' || job.firstReportCheck.source === 'worker')) return job.firstReportCheck;
    let actual;
    let mismatches;
    try {
      actual = await workerCheckpoint(project, job.row, `${job.row.task}\n${job.card}`);
      mismatches = workerCheckpointMismatch(job.checkpoint, actual);
    } catch { mismatches = ['checkout-or-rulings-unavailable']; }
    const previous = job.firstReportCheck;
    job.firstReportCheck = { status: mismatches.length ? 'mismatch' : 'verified', at, source, mismatches,
      ...(actual && { actual }) };
    try { save(job); }
    catch (error) { job.firstReportCheck = previous; throw error; }
    return job.firstReportCheck;
  }

  async function workerHandoff(job, reason, at, { acceptance, card, evidence }) {
    const cardId = card?.id ?? job.firstId;
    const previous = job.workerHandoff;
    if (previous?.path && previous.cardId === cardId && previous.reason === reason && !acceptance && !evidence) return previous;
    const text = card?.nextCard ? card.text : job.card ?? job.prompt;
    const path = await writeWorkerHandoff(project, job.row, text, reason,
      { acceptance, evidence, cardId, startedAt: card?.received?.at ?? job.row.startedAt });
    job.workerHandoff = { reason, at, path, cardId, ready: Boolean(acceptance) };
    save(job);
    return job.workerHandoff;
  }

  function released(job, row, at) {
    const { by, gate, idleSinceBeforeRelease, context } = job.retention.releasing;
    running.delete(row.addr);
    restored.delete(row.addr);
    openCodeProofs.delete(row.addr);
    delete job.userPrompt;
    delete job.liveness;
    const previous = job.releases;
    const previousClose = job.closed;
    if (['gate-approved', 'first-report-mismatch', 'worker-handoff'].includes(by) || isThresholdRetirement(by)) {
      job.closed = { at, reason: by, contextPercent: context?.contextPercent };
    }
    else if (row.role === 'worker') job.releases = [...previous ?? [], { at, by, gate }];
    try {
      setRetention(job, { ...(by !== 'ttl' && { keep: false }), ...(job.closed && { keepWarm: false }), releasedAt: at,
        releasedBy: by, idleSinceBeforeRelease, lastContext: context,
        releasing: undefined, eligible: false, idleSince: undefined, idleStream: undefined });
    } catch (error) {
      job.releases = previous;
      job.closed = previousClose;
      throw error;
    }
    return row;
  }

  async function release(row, view, at, by, context) {
    const job = jobs.get(row.addr);
    const runtime = running.get(row.addr);
    if (!runtime || !idleForRelease(view) || runtime.streamId !== view.streamId) {
      throw new ErrorCode('not-ready', 'Session has no verified idle runtime');
    }
    if (!job.retention?.releasing) setRetention(job, { releasing: {
      by, gate: job.barrier ?? row.wave, context, idleSinceBeforeRelease: workerIdleSince(view, at, job.retention),
    } });
    try {
      if (runtime.hosted) await runtime.close({ idleStream: view.streamId });
      else await disposeSession(runtime.session);
    } catch (error) {
      if (error.kind === 'status_mismatch') setRetention(job, { releasing: undefined, idleSince: undefined });
      throw error;
    }
    runtime.unsubscribe?.();
    released(job, row, at);
  }

  async function resume(row, mail, at, warmMs) {
    requireLive(row);
    const job = jobs.get(row.addr);
    if (job?.hostGrant) throw new ErrorCode('host-grant-required', 'Start a new host session with a grant use');
    if (!job || row.backend !== 'headless' || row.role !== 'worker' || job.stopping || job.closed ||
        job.workerHandoff?.ready || job.firstReportCheck?.status === 'mismatch' || !row.sessionId) {
      throw new ErrorCode('not-ready', 'Expected a resumable headless worker attempt');
    }
    if (!isReleased(job)) return row;
    if (!job.retention.resuming) {
      delete job.host;
      delete job.pipeRecovery;
      setRetention(job, { resuming: { at, warmUntil: (job.retention.idleSinceBeforeRelease ?? job.retention.releasedAt) + warmMs } });
    }
    const resumed = await activate(job, mail);
    retryAt.delete(row.addr);
    return resumed;
  }

  async function closeWorker(row, reason, at, contextPercent) {
    const job = jobs.get(row.addr);
    if (!job.closed) {
      job.closed = { reason, at, contextPercent };
      save(job);
    }
    return stop(row);
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
      if (!runtime && job.host && (!isReleased(job) || job.retention.resuming)) {
        runtime = await attachHeadless(row, job, { stop: true });
      }
      if (runtime?.hosted) {
        endedAt = (await runtime.close()).endedAt;
        await refreshAccounts(job, row, { transcript: runtime.transcriptPath, runtime });
      }
      else if (runtime?.session) await disposeSession(runtime.session);
      else endedAt = runtime?.endedAt;
      runtime?.unsubscribe?.();
      running.delete(row.addr);
    } else if (row.backend === 'tui') {
      const terminal = await getPane(job, row);
      if (terminal && !completedPane(terminal)) await terminalCall(job, 'kill', terminal.address);
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
    return Promise.all(rows().filter(row => row.endedAt === null &&
      (!isReleased(jobs.get(row.addr)) || jobs.get(row.addr).retention.resuming)).map(async row => {
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

  async function sessionMemory() {
    const entries = await Promise.all(rows().filter(row => row.endedAt === null && jobs.has(row.addr)).map(async row => {
      const job = jobs.get(row.addr);
      const dormant = isReleased(job) && !job.retention.resuming;
      let root;
      if (!dormant && row.backend === 'headless') {
        const runtime = running.get(row.addr);
        if (runtime?.hosted) root = { pid: runtime.pid, identity: runtime.identity ?? job.host?.identity, detached: true };
      } else if (!dormant) {
        const pane = await getPane(job, row).catch(() => undefined);
        if (pane && !completedPane(pane)) root = { pid: pane.pid };
      }
      return { project: row.project, dormant, root };
    }));
    return projectSessionMemory(project, entries);
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

  async function adoptLayout(addresses) {
    if (!layout) throw new ErrorCode('not-ready', 'Herdr layout is unavailable');
    const all = rows();
    const entries = await Promise.all(visibleRoles.map(async role => {
      const row = all.find(item => item.pane === addresses[role] && item.role === role && item.endedAt === null);
      const job = row && jobs.get(row.addr);
      if (!job || !job.paneBinding || routeParent(row.addr)?.addr !== row.addr || awaitingBrief(job)) {
        throw new ErrorCode('invalid-arguments', `Expected this project's live, daemon-owned ${role} hc address`);
      }
      const terminal = await getPane(job, row);
      if (!terminal || completedPane(terminal)) throw new ErrorCode('not-ready', `No live hc terminal for ${role}`);
      return { row, terminal };
    }));
    return layout.adopt(entries);
  }

  return { rows, rowFor, events, targetBinding, transport, requestedMode, canInterrupt, resolve, requireLive, newJob,
    activate, failSpawn, failHandover, runtimeSelection, refresh, stop, closeWorker, release, resume, setRetention,
    verifyWorkerStart, workerHandoff, sessionMemory,
    shutdown, upgradeSessions, upgradeHolder, jobs, managedHc, sealed, lastActivity,
    routeParent, bindSuccessor, retirePredecessor, finalizeV2, legacyPeerCaller, legacySessions, liveCaller, successorOf, holdsForHandover, rememberUserPrompt, pathWarnings, rememberLiveness, adoptLayout,
    runtimeContext: addr => running.get(addr)?.session.contextUsage?.()?.value,
    markHandoverStarted(job) {
      save({ ...job, handoverWorkStarted: true });
      job.handoverWorkStarted = true;
    },
    finishObserved(row, exit, at) { return finish(jobs.get(row.addr), row, at, exit); } };
}
