import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnSync } from '../fixtures/test-process.mjs';
import { projectIndex } from '../cli/project.mjs';
import { deliveryId } from '../inbox/message.mjs';
import { createSupervisor } from './supervisor.mjs';
import { authorizeSocketCommand } from './socket-auth.mjs';
import { readGlobalRegistry, registerGlobalProject, resolveAccountDir, superHandoffPath } from './global-registry.mjs';
import { recoverAllProjects, recoverProject, requireSuperCaller } from './recover.mjs';
import { createClaudeCcpBridge, defaultCcpClaudeEntry } from './claude-ccp.mjs';
import { superUp } from './super-up.mjs';
import { roleCore } from '../lib/role-skill.mjs';

function restartFixture(t, extraOptions = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'loom-restart-'));
  const home = join(root, 'home');
  const globalDir = join(root, 'global');
  const project = join(root, 'proj-1');
  const worktree = join(project, 'wt-card');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(join(project, '.project'), { recursive: true, mode: 0o700 });
  mkdirSync(worktree, { recursive: true, mode: 0o700 });
  const env = {
    HOME: home,
    LOOM_GLOBAL_DIR: globalDir,
    CODEX_HOME: join(home, '.codex'),
    ANTIGRAVITY_APP_DATA_DIR: join(home, '.gemini', 'antigravity-cli'),
    CLAUDE_CONFIG_DIR: join(home, '.claude'),
    XDG_DATA_HOME: join(home, '.local', 'share'),
    XDG_STATE_HOME: join(root, 'state'),
  };
  const savedEnv = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  });

  writeFileSync(join(project, '.project', 'policy.json'), JSON.stringify({
    delivery: { coalesceMs: 0 },
    roles: {
      auditor: { preferred: [{ cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode: 'headless' }] },
      leader: { maxActiveWorkers: 4, preferred: [{ cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode: 'headless' }] },
      worker: { preferred: [{ cli: 'codex', model: 'gpt-6.2-sol', effort: 'medium', mode: 'headless' }] },
    },
  }));
  writeFileSync(join(project, '.project', 'rulings.md'), '# R1: All Claude goes through CCP\n');

  const liveSessions = new Map();
  const prompts = [];
  const resumes = [];
  let hangNextResume = false;

  async function open(row, _, resume) {
    if (resume) {
      resumes.push({ addr: row.addr, sessionId: resume, cli: row.cli, model: row.model, cwd: row.cwd, hostGrant: row.hostGrant });
      if (hangNextResume) {
        hangNextResume = false;
        await new Promise(() => {});
      }
    }
    const id = resume ?? randomUUID();
    const transcript = join(project, `${id}.jsonl`);
    writeFileSync(transcript, '', { flag: 'a' });
    let seq = 0;
    let observer;
    let active;
    const session = {
      id,
      records: () => [],
      status: () => ({ value: active ? { kind: 'running', sinceSeq: active.sinceSeq, lastEventAt: active.at } : { kind: 'idle' } }),
      events: notify => { observer = notify; return () => { observer = undefined; }; },
      nativeSessionFile: async () => transcript,
      async dispose() { emit('exited'); },
      async prompt(input) {
        const inputId = deliveryId(input);
        const requestId = randomUUID();
        active = { input, inputId, sinceSeq: seq, spanId: randomUUID(), at: Date.now() };
        prompts.push({ addr: row.addr, id: inputId, input });
        emit('turn_started', { requestId, input });
        emit('turn_active', { inputId });
        if (!input.includes('HOLD')) {
          finish(row.role === 'worker' ? `DONE ${row.task}` : 'NOREPLY');
        }
        return { kind: 'accepted', requestId, seq: seq - 1 };
      },
      async abort() {
        emit('turn_ended', { outcome: { kind: 'aborted' } });
        active = undefined;
        return { kind: 'accepted', requestId: randomUUID(), seq: seq - 1 };
      },
    };
    function emit(kind, data = {}, receivedAt = Date.now()) {
      observer?.({ kind, ...data, agentPath: [], sessionId: id, seq: seq++, receivedAt, spanId: active?.spanId });
    }
    function finish(body, at = Date.now()) {
      const turn_id = active.spanId;
      const rows = [{ type: 'task_started', turn_id }, { type: 'task_complete', turn_id, last_agent_message: body }];
      appendFileSync(transcript, rows.map(payload => JSON.stringify({ type: 'event_msg', timestamp: new Date(at).toISOString(), payload }) + '\n').join(''));
      emit('text_delta', { phase: 'final_answer', text: body }, at);
      emit('turn_ended', { inputId: active.inputId, outcome: { kind: 'completed' } }, at);
      active = undefined;
    }
    function crash(at = Date.now()) {
      emit('exited', { code: 137 }, at);
    }
    liveSessions.set(row.addr, { session, finish, crash, emit });
    return session;
  }

  const startDaemon = (opts = {}) => {
    const sup = createSupervisor(project, {
      report: () => {}, externalNotification: async () => {},
      ...extraOptions, ...opts,
      sessionOptions: { open, ...extraOptions.sessionOptions, ...opts.sessionOptions },
    });
    return {
      ...sup,
      handle: (command, args = {}, caller, identity = { external: !caller }) => sup.handle(command, args, caller, identity),
    };
  };

  return {
    root, home, globalDir, project, worktree, env,
    startDaemon, liveSessions, prompts, resumes,
    hangNextResume: () => { hangNextResume = true; },
    read: part => JSON.parse(readFileSync(join(project, '.project', part), 'utf8')),
  };
}

test('full restart flow: loom up -> Super -> loom recover --all-projects -> project up -> resume Auditor -> Leader -> worker', async t => {
  const f = restartFixture(t);
  registerGlobalProject(f.project, { release: 'rel-v1', lastOnlineAt: Date.now() - 10_000, lastShutdown: 'abnormal' }, f.env);

  // Phase 1: Live project before reboot.
  let d = f.startDaemon();
  const { session: auditor } = await d.handle('spawn', {
    role: 'auditor', cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode: 'headless', cwd: f.project, project: f.project, prompt: 'start auditor',
  });
  const { session: leader } = await d.handle('spawn', {
    role: 'leader', cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode: 'headless', cwd: f.project, project: f.project, prompt: 'start leader',
  });
  // Issue host grant (uses=1) and spawn a host-tier worker in worktree.
  const grantRes = await d.handle('grant', {
    target: 'CARD-1', tier: 'host', reason: 'Need host access', uses: '1', ttl: '1h', write: [],
  });
  assert.ok(grantRes.handoffReminder && !grantRes.handoffReminder.includes('\n'));
  const { session: worker } = await d.handle('spawn', {
    role: 'worker', task: 'CARD-1', wave: 'W1', tier: 'host', cli: 'codex', model: 'gpt-6.2-sol', effort: 'medium',
    mode: 'headless', cwd: f.worktree, project: f.project, prompt: 'HOLD do card work',
  }, leader.addr);
  await d.tick();
  await d.tick();

  // Confirm initial turn delivered to leader, then hold leader and queue a follow-up before crash!
  const holdLeader = await d.handle('send', { target: leader.addr, text: 'HOLD active turn', mode: 'queue' });
  await d.tick();
  const queuedLeader = await d.handle('send', { target: leader.addr, text: 'Post-reboot task for leader', mode: 'queue' });
  const queuedWorker = await d.handle('send', { target: worker.addr, text: 'Post-reboot follow-up for worker', mode: 'queue' }, leader.addr);
  assert.ok(queuedLeader.deliveryId);
  assert.ok(queuedWorker.deliveryId);

  // Record a needs-decision notification before reboot.
  await d.handle('notifications', { decision: 'Approve migration path', kind: 'decision' }, leader.addr);

  // Simulate abrupt crash / reboot: all three sessions exit unexpectedly and daemon shuts down.
  f.liveSessions.get(auditor.addr).crash();
  f.liveSessions.get(leader.addr).crash();
  f.liveSessions.get(worker.addr).crash();
  await d.tick();
  await d.shutdown();

  // Verify host grant currently has 1 claim (0 remaining).
  const grantsBefore = f.read('loomd/host-grants.json').grants;
  assert.equal(grantsBefore[0].claims.length, 1);

  // Phase 2: After reboot -> loom up launches fresh Super (writes live.md with project + decision + unrecovered).
  const superLaunch = await superUp({ fresh: true, cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', cwd: f.home }, {
    env: f.env, herdrOptional: true,
    launcher: async () => ({ hcAddress: 't-super', sessionId: randomUUID(), ready: true }),
  });
  assert.equal(superLaunch.ok, true);
  assert.equal(superLaunch.action, 'fresh');
  assert.ok(superLaunch.live.text.includes('proj-1'));
  assert.equal(readGlobalRegistry(f.env).super.hcAddress, 't-super');

  // Phase 3: Super runs loom recover --all-projects (read-only, Super-only).
  assert.throws(() => requireSuperCaller({ LOOM_ADDR: leader.addr, LOOM_PROJECT: f.project }, f.project), { code: 'forbidden' });
  assert.throws(() => requireSuperCaller({}, f.project), { code: 'forbidden' });
  assert.doesNotThrow(() => requireSuperCaller({ ...f.env, LOOM_EXTERNAL_SUPER: '1' }, f.project));

  const recovered = await recoverAllProjects({ env: f.env, checkDaemon: async () => false });
  assert.equal(recovered.projects.length, 1);
  const items = recovered.projects[0].sessions;
  assert.deepEqual(items.map(item => item.role), ['auditor', 'leader', 'worker']);
  const leaderItem = items.find(item => item.addr === leader.addr);
  const workerItem = items.find(item => item.addr === worker.addr);
  assert.equal(leaderItem.sessionId, leader.sessionId);
  assert.ok(leaderItem.pendingDeliveries >= 1);
  assert.equal(leaderItem.nativeResume.supported, true);
  assert.equal(workerItem.task, 'CARD-1');
  assert.equal(workerItem.worktree, f.worktree);
  assert.equal(workerItem.workerTier, 'host');
  assert.equal(workerItem.hasHostGrant, true);

  // Phase 4: Super starts project daemon (`loom project up`), then resumes Auditor -> Leader -> worker.
  d = f.startDaemon();
  t.after(() => d.shutdown());

  // Non-super cannot call resume or recover via RPC.
  assert.throws(() => authorizeSocketCommand('resume', { target: auditor.addr }, { role: 'leader' }), { code: 'forbidden' });
  assert.throws(() => authorizeSocketCommand('recover', {}, { role: 'auditor' }), { code: 'forbidden' });
  assert.doesNotThrow(() => authorizeSocketCommand('resume', { target: auditor.addr }, { role: 'super' }));

  const promptsBeforeResume = f.prompts.length;

  // Resume Auditor -> Leader -> Worker.
  const rAuditor = await d.handle('resume', { target: auditor.addr });
  assert.equal(rAuditor.resumed, true);
  assert.equal(rAuditor.session.addr, auditor.addr);
  assert.equal(rAuditor.session.sessionId, auditor.sessionId);
  assert.equal(rAuditor.session.endedAt, null);

  const rLeader = await d.handle('resume', { target: leader.addr });
  assert.equal(rLeader.resumed, true);
  assert.equal(rLeader.session.addr, leader.addr);
  assert.ok(rLeader.replayedDeliveries.includes(queuedLeader.deliveryId));
  assert.ok(!rLeader.replayedDeliveries.includes(holdLeader.deliveryId));

  const rWorker = await d.handle('resume', { target: worker.addr });
  assert.equal(rWorker.resumed, true);
  assert.equal(rWorker.session.addr, worker.addr);
  assert.equal(rWorker.session.task, 'CARD-1');
  assert.equal(rWorker.session.cwd, f.worktree);
  assert.equal(rWorker.hostGrantPreserved, true);
  assert.ok(rWorker.replayedDeliveries.includes(queuedWorker.deliveryId));

  // Verify host grant was NOT re-debited!
  const grantsAfter = f.read('loomd/host-grants.json').grants;
  assert.equal(grantsAfter[0].claims.length, 1);

  // Tick so replayed deliveries land on resumed sessions, without duplicating already-received messages.
  await d.tick();
  await d.tick();
  const replayedPrompts = f.prompts.slice(promptsBeforeResume);
  assert.equal(replayedPrompts.filter(p => p.id === queuedLeader.deliveryId).length, 1);
  assert.equal(replayedPrompts.filter(p => p.id === queuedWorker.deliveryId).length, 1);
  assert.equal(replayedPrompts.filter(p => p.id === holdLeader.deliveryId).length, 0);
  // Original startup prompt (firstId) must NOT be replayed on resume!
  const firstIds = [auditor, leader, worker].map(row => f.read(`loomd/sessions/${row.addr}.json`).firstId);
  for (const id of firstIds) assert.equal(replayedPrompts.filter(p => p.id === id).length, 0);
});

test('loom resume enforces CLI/model/accountDir verification, 120s timeout abort, unsupported CLI hint, and Claude CCP stub', async t => {
  const f = restartFixture(t);
  writeFileSync(join(f.project, '.project', 'policy.json'), JSON.stringify({
    preferred: [
      { cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode: 'headless' },
      { cli: 'agy', model: 'gemini-4-neon', effort: 'high', mode: 'headless' },
      { cli: 'claude', model: 'claude-opus-5-5', effort: 'high', mode: 'headless' },
      { cli: 'opencode', model: 'deepseek/deepseek-flash', effort: 'high', mode: 'headless' },
    ],
    deny: [],
  }));
  const d = f.startDaemon({ sessionOptions: { ccpBridge: createClaudeCcpBridge() } });
  t.after(() => d.shutdown());

  const { session: codex } = await d.handle('spawn', {
    role: 'leader', cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode: 'headless', cwd: f.project, project: f.project, prompt: 'start',
  });
  await d.tick();
  f.liveSessions.get(codex.addr).crash();
  await d.tick();

  // Mismatch checks reject cleanly before launch.
  await assert.rejects(d.handle('resume', { target: codex.addr, cli: 'agy' }), { code: 'resume-mismatch' });
  await assert.rejects(d.handle('resume', { target: codex.addr, model: 'wrong-model' }), { code: 'resume-mismatch' });
  await assert.rejects(d.handle('resume', { target: codex.addr, accountDir: '/tmp/other-account' }), { code: 'resume-mismatch' });

  // Timeout aborts launch and leaves session ended.
  f.hangNextResume();
  await assert.rejects(d.handle('resume', { target: codex.addr, timeoutMs: 40 }), { code: 'resume-timeout' });
  assert.notEqual(projectIndex(f.project).query({ addr: codex.addr })[0].endedAt, null);

  // Unsupported fixed version (e.g. agy 1.4.0) reports "无法原生续接" + fresh handoff command.
  const { session: agy } = await d.handle('spawn', {
    role: 'auditor', cli: 'agy', model: 'gemini-4-neon', effort: 'high', mode: 'headless', cwd: f.project, project: f.project, prompt: 'start agy',
  });
  await d.tick();
  f.liveSessions.get(agy.addr).crash();
  await d.tick();
  await assert.rejects(
    d.handle('resume', { target: agy.addr, cliVersion: '1.4.0' }),
    error => error.code === 'resume-unsupported' && /无法原生续接/.test(error.message) && /loom spawn auditor/.test(error.freshCommand ?? error.message),
  );

  // Claude session calls CCP-ROUTE-1 interface -> returns not-ready (never spawns Claude); non-CCP entry -> ccp-required.
  const { session: claudeRow } = await d.handle('spawn', {
    role: 'worker', task: 'CLAUDE-T', wave: 'W1', cli: 'claude', model: 'claude-opus-5-5', effort: 'high',
    mode: 'headless', cwd: f.project, project: f.project, prompt: 'HOLD',
  }, codex.addr);
  await d.tick();
  f.liveSessions.get(claudeRow.addr).crash();
  await d.tick();

  const resumesBefore = f.resumes.length;
  await assert.rejects(d.handle('resume', { target: claudeRow.addr, entry: defaultCcpClaudeEntry(f.env) }), { code: 'not-ready' });
  await assert.rejects(d.handle('resume', { target: claudeRow.addr, entry: join(f.home, '.local/share/claude/versions/2.1.331') }),
    { code: 'ccp-required' });
  assert.equal(f.resumes.length, resumesBefore);
});

test('Super handoff reminders attach a single line after rulings and before session close without extra requests', async t => {
  const f = restartFixture(t);
  const d = f.startDaemon();
  t.after(() => d.shutdown());
  const { session: leader } = await d.handle('spawn', {
    role: 'leader', cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode: 'headless', cwd: f.project, project: f.project, prompt: 'start',
  });
  const { session: superSession } = await d.handle('spawn', {
    role: 'super', cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode: 'headless', cwd: f.project, project: f.project, prompt: 'start super',
  });
  await d.tick();

  // Super ruling send attaches one-line handoffReminder.
  const sendRes = await d.handle('send', { target: leader.addr, text: '裁决：按新方案执行。', mode: 'queue' });
  assert.ok(sendRes.handoffReminder && !sendRes.handoffReminder.includes('\n'));
  assert.ok(sendRes.handoffReminder.includes(superHandoffPath(f.env)));

  // Taking a needs-decision notification attaches handoffReminder.
  await d.handle('notifications', { decision: 'Choose A or B', kind: 'decision' }, leader.addr);
  const taken = await d.handle('notifications', { take: true });
  assert.ok(taken.handoffReminder && !taken.handoffReminder.includes('\n'));

  // Stopping Super session attaches handoffReminder and marks cleanExit in global.json.
  const stopped = await d.handle('stop', { target: superSession.addr });
  assert.ok(stopped.handoffReminder && !stopped.handoffReminder.includes('\n'));
  assert.equal(readGlobalRegistry(f.env).super.cleanExit, true);
});

test('Super skill documents restart/recovery steps in 3-5 lines', () => {
  const index = readFileSync(new URL('../skills/loom/SKILL.md', import.meta.url), 'utf8');
  assert.match(index, /roles\/super\.md/);
  const skill = roleCore('super');
  assert.match(skill, /中断\/重启后的恢复步骤/);
  assert.match(skill, /loom up/);
  assert.match(skill, /loom recover --all-projects/);
  assert.match(skill, /loom project up/);
  assert.match(skill, /loom resume/);
  assert.match(skill, /handoff\.md/);
});

test('invariant [idempotency] repeated resume never duplicates delivered messages and rejects expired host grants', async t => {
  let offset = 0;
  const f = restartFixture(t, { now: () => Date.now() + offset });
  const d = f.startDaemon();
  t.after(() => d.shutdown());

  const { session: leader } = await d.handle('spawn', {
    role: 'leader', cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode: 'headless', cwd: f.project, project: f.project, prompt: 'start leader',
  });
  await d.handle('grant', { target: 'EXP-1', tier: 'host', reason: 'Short TTL', uses: '1', ttl: '10s', write: [] });
  const { session: worker } = await d.handle('spawn', {
    role: 'worker', task: 'EXP-1', wave: 'W1', tier: 'host', cli: 'codex', model: 'gpt-6.2-sol', effort: 'medium',
    mode: 'headless', cwd: f.worktree, project: f.project, prompt: 'HOLD card',
  }, leader.addr);
  await d.tick();

  // Deliver one message and confirm it completes, then queue another, then crash twice.
  const firstMsg = await d.handle('send', { target: leader.addr, text: 'Completed before crash', mode: 'queue' });
  await d.tick();
  const secondMsg = await d.handle('send', { target: leader.addr, text: 'HOLD active before crash', mode: 'queue' });
  await d.tick();
  const thirdMsg = await d.handle('send', { target: leader.addr, text: 'Pending across crash', mode: 'queue' });
  f.liveSessions.get(leader.addr).crash();
  f.liveSessions.get(worker.addr).crash();
  await d.tick();

  const resumed1 = await d.handle('resume', { target: leader.addr });
  assert.ok(resumed1.replayedDeliveries.includes(thirdMsg.deliveryId));
  assert.ok(!resumed1.replayedDeliveries.includes(firstMsg.deliveryId));
  assert.ok(!resumed1.replayedDeliveries.includes(secondMsg.deliveryId));
  await d.tick();
  await d.tick();
  assert.equal(f.prompts.filter(item => item.id === firstMsg.deliveryId).length, 1);
  assert.equal(f.prompts.filter(item => item.id === secondMsg.deliveryId).length, 1);
  assert.equal(f.prompts.filter(item => item.id === thirdMsg.deliveryId).length, 1);

  // Second crash & resume: nothing already delivered is replayed.
  f.liveSessions.get(leader.addr).crash();
  await d.tick();
  const resumed2 = await d.handle('resume', { target: leader.addr });
  assert.deepEqual(resumed2.replayedDeliveries, []);
  await d.tick();
  assert.equal(f.prompts.filter(item => item.id === thirdMsg.deliveryId).length, 1);

  // Advance past host grant TTL -> resuming expired host worker is rejected.
  offset = 20_000;
  await assert.rejects(d.handle('resume', { target: worker.addr }), { code: 'host-grant-expired' });
});

test('TUI Codex resume passes original sessionId and CODEX_HOME to openPane and rejects OpenCode TUI resume', async t => {
  const f = restartFixture(t);
  writeFileSync(join(f.project, '.project', 'policy.json'), JSON.stringify({
    preferred: [
      { cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode: 'tui' },
      { cli: 'opencode', model: 'deepseek/deepseek-flash', effort: 'high', mode: 'tui' },
    ],
    deny: [],
  }));
  const opened = [];
  const panes = new Map();
  let seq = 0;
  const openPane = async (job, row) => {
    opened.push({ addr: row.addr, cli: row.cli, resumeNativeId: job.resumeNativeId, accountDir: job.accountDir });
    const address = `t${++seq}`;
    const nativeId = job.resumeNativeId ?? randomUUID();
    const terminal = { address, name: `pane-${seq}`, cwd: row.cwd, state: 'live', created_ms: Date.now(), pid: 5000 + seq, status_ms: Date.now() };
    panes.set(row.addr, terminal);
    return { terminal, nativeId };
  };
  const getPane = async (_job, row) => panes.get(row.addr);
  const callHc = async (cmd, target) => {
    const entry = [...panes.values()].find(pane => pane.address === target || pane.name === target);
    if (cmd === 'read') return { text: '› \n', turn: 1, state: entry?.state ?? 'finished' };
    return entry ?? { state: 'finished' };
  };

  const fakeOpencode = join(f.root, 'opencode');
  writeFileSync(fakeOpencode, `#!${process.execPath}
const idx = process.argv.indexOf('export');
console.log(JSON.stringify({ info: { id: process.argv[idx + 1] }, messages: [] }));
`, { mode: 0o700 });
  const prevOpencode = process.env.LOOM_OPENCODE_BIN;
  process.env.LOOM_OPENCODE_BIN = fakeOpencode;
  t.after(() => {
    if (prevOpencode === undefined) delete process.env.LOOM_OPENCODE_BIN;
    else process.env.LOOM_OPENCODE_BIN = prevOpencode;
  });

  const d = f.startDaemon({ sessionOptions: { openPane, getPane, callHc, exportOpenCode: async () => ({ events: [] }) } });
  t.after(() => d.shutdown());

  const { session: codexTui } = await d.handle('spawn', {
    role: 'leader', cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode: 'tui', cwd: f.project, project: f.project, prompt: 'start tui',
  });
  const { session: opencodeTui } = await d.handle('spawn', {
    role: 'auditor', cli: 'opencode', model: 'deepseek/deepseek-flash', effort: 'high', mode: 'tui', cwd: f.project, project: f.project, prompt: 'start opencode',
  });
  // OpenCode TUI sets plannedNativeId; simulate SessionStart so sessionId is persisted in index before crash.
  const openJob = f.read(`loomd/sessions/${opencodeTui.addr}.json`);
  projectIndex(f.project).update(opencodeTui.addr, { sessionId: openJob.plannedNativeId });
  await d.tick();

  // Crash both TUI panes.
  panes.get(codexTui.addr).state = 'finished';
  panes.get(codexTui.addr).finished_ms = Date.now();
  panes.get(opencodeTui.addr).state = 'finished';
  panes.get(opencodeTui.addr).finished_ms = Date.now();
  await d.tick();

  // Codex TUI resumes with original sessionId and CODEX_HOME accountDir.
  const resumed = await d.handle('resume', { target: codexTui.addr });
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.session.sessionId, codexTui.sessionId);
  const resumeCall = opened.find(item => item.addr === codexTui.addr && item.resumeNativeId);
  assert.ok(resumeCall);
  assert.equal(resumeCall.resumeNativeId, codexTui.sessionId);
  assert.equal(resumeCall.accountDir, resolveAccountDir('codex', f.env));

  // OpenCode 2.3.0 TUI reports "无法原生续接" and provides a fresh-with-handoff command.
  await assert.rejects(
    d.handle('resume', { target: opencodeTui.addr }),
    error => error.code === 'resume-unsupported' && /无法原生续接/.test(error.message) && /loom spawn auditor/.test(error.freshCommand ?? error.message),
  );
});

test('CLI loom project up, deprecated loom up --project, loom recover, and loom super --close work end-to-end', async t => {
  const f = restartFixture(t);
  const loomBin = fileURLToPath(new URL('../bin/loom', import.meta.url));
  const runLoom = (args, extraEnv = {}) => spawnSync(process.execPath, [loomBin, ...args], {
    cwd: f.project,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, ...f.env, LOOM_HERDR_LAYOUT: '0', ...extraEnv },
  });

  // 1. loom project up DIR starts loomd and registers project in global.json.
  const up = runLoom(['project', 'up', f.project], { LOOM_EXTERNAL_SUPER: '1' });
  assert.equal(up.status, 0, up.stderr || up.stdout);
  const upJson = JSON.parse(up.stdout);
  assert.equal(upJson.ok, true);
  assert.equal(upJson.project, f.project);
  assert.equal(readGlobalRegistry(f.env).projects.some(item => item.dir === f.project && item.lastShutdown === 'abnormal'), true);

  // 2. Legacy loom up --project DIR still works and emits deprecation hint on stderr + JSON.
  const legacy = runLoom(['up', '--project', f.project], { LOOM_EXTERNAL_SUPER: '1' });
  assert.equal(legacy.status, 0, legacy.stderr || legacy.stdout);
  assert.match(legacy.stderr, /loom project up DIR/);
  assert.equal(JSON.parse(legacy.stdout).deprecated, 'Use loom project up DIR');

  // 3. loom daemon stop marks project lastShutdown: 'normal' in global.json.
  const stopped = runLoom(['daemon', 'stop', '--project', f.project], { LOOM_EXTERNAL_SUPER: '1' });
  assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout);
  assert.equal(readGlobalRegistry(f.env).projects.find(item => item.dir === f.project).lastShutdown, 'normal');

  // 4. loom recover requires Super (rejects non-Super, succeeds for external Super).
  const denied = runLoom(['recover', '--all-projects', '--json'], { LOOM_EXTERNAL_SUPER: '' });
  assert.notEqual(denied.status, 0);
  assert.equal(JSON.parse(denied.stdout).error.code, 'forbidden');

  const allowed = runLoom(['recover', '--all-projects', '--json'], { LOOM_EXTERNAL_SUPER: '1' });
  assert.equal(allowed.status, 0, allowed.stderr || allowed.stdout);
  assert.equal(JSON.parse(allowed.stdout).ok, true);
  assert.equal(JSON.parse(allowed.stdout).projects.length, 1);

  // 5. loom super --close records cleanExit: true and emits one-line handoffReminder.
  const closed = runLoom(['super', '--close']);
  assert.equal(closed.status, 0, closed.stderr || closed.stdout);
  const closedJson = JSON.parse(closed.stdout);
  assert.equal(closedJson.cleanExit, true);
  assert.ok(closedJson.handoffReminder && !closedJson.handoffReminder.includes('\n'));
  assert.equal(readGlobalRegistry(f.env).super.cleanExit, true);
});
