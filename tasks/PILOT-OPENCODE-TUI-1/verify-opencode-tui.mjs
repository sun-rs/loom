import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import opencode, { projectMessages } from '../../adapters/opencode/index.mjs';
import { eventPath } from '../../daemon/io.mjs';
import { refreshOpenCode } from '../../daemon/tui.mjs';
import { openNativeTui } from '../../runtimes/tui/transport.mjs';

const exec = promisify(execFile);
const OPENCODE_BIN = '/opt/homebrew/bin/opencode';
const MODEL = 'deepseek/deepseek-flash';
const EVIDENCE_OUT = new URL('./evidence.json', import.meta.url);

async function exportSession(sessionId, cwd) {
  const { stdout } = await exec(OPENCODE_BIN, ['session', 'export', sessionId, '--standalone'], {
    cwd, timeout: 10_000, maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function waitFor(label, fn, { timeoutMs = 25_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last?.ok) return last;
    await sleep(intervalMs);
  }
  throw new Error(`Timeout waiting for ${label}: ${JSON.stringify(last)}`);
}

const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-oc-verify-')));
const project = join(root, 'project');
const cwd = join(root, 'workspace');
await mkdir(join(project, '.project', 'pty'), { recursive: true });
await mkdir(cwd, { recursive: true });

const sessionId = `ses_${randomUUID().replaceAll('-', '')}`;
const addr = `oc-verify-${sessionId.slice(4, 10)}`;
const paneName = `loom-${addr.replaceAll('-', '').slice(0, 22)}`;
const hookSink = eventPath(project, addr);
const row = { addr, cli: 'opencode', cwd };
const job = { plannedNativeId: sessionId, paneBinding: { createdAt: Date.now() } };

let host;
let stopPoller = false;
let pollerPromise;
const evidence = {
  model: MODEL,
  opencodeBin: OPENCODE_BIN,
  sessionId,
  tests: {},
};

const syncOnce = () => refreshOpenCode(job, row, project).catch(() => null);

try {
  // 1. Cold start
  const t0 = Date.now();
  host = await openNativeTui({
    cli: 'opencode',
    cwd,
    command: OPENCODE_BIN,
    model: MODEL,
    sessionId,
    name: paneName,
    stateDir: join(project, '.project', 'pty'),
    hookSink,
  });
  job.paneBinding = { createdAt: Date.now() };

  pollerPromise = (async () => {
    while (!stopPoller) {
      await syncOnce();
      await sleep(350);
    }
  })();

  const readyState = await waitFor('cold-start ready', async () => {
    await syncOnce();
    const st = await host.readState();
    return {
      ok: st.ready === true && st.phase === 'idle' && st.screen?.kind === 'idle' && st.screen?.empty === true && st.native?.phase === 'idle',
      state: { phase: st.phase, source: st.source, ready: st.ready, screenKind: st.screen?.kind, empty: st.screen?.empty, draft: st.screen?.draft, nativePhase: st.native?.phase },
    };
  }, { timeoutMs: 25_000, intervalMs: 300 });

  evidence.tests.coldStart = {
    passed: true,
    elapsedMs: Date.now() - t0,
    transport: host.transport,
    paneId: host.id,
    ...readyState.state,
  };
  console.log('1. COLD START PASS:', JSON.stringify(evidence.tests.coldStart));

  // 2. 5 queued deliveries with native confirmation (0 loss, 0 duplicate)
  const queue = Array.from({ length: 5 }, (_, i) => ({
    index: i + 1,
    deliveryId: randomUUID(),
    token: `Q${i + 1}`,
    text: `Reply with only Q${i + 1}`,
  }));
  const deliveryReceipts = [];

  for (const item of queue) {
    const before = await waitFor(`ready before ${item.token}`, async () => {
      await syncOnce();
      const st = await host.readState();
      return { ok: st.ready === true && st.screen?.empty === true, st };
    }, { timeoutMs: 20_000 });

    const submitRes = await host.submit({
      id: item.deliveryId,
      text: item.text,
      generation: before.st.host.generation,
      timeoutMs: 15_000,
    });
    assert.equal(submitRes.kind, 'confirmed', `Expected confirmed for ${item.token}, got ${JSON.stringify(submitRes)}`);
    assert.equal(submitRes.confirmation?.count, 1, `Expected count=1 for ${item.token}`);

    await waitFor(`idle after ${item.token}`, async () => {
      await syncOnce();
      const st = await host.readState();
      return { ok: st.ready === true && st.native?.phase === 'idle' && st.screen?.kind === 'idle', phase: st.phase, screen: st.screen?.kind, native: st.native?.phase };
    }, { timeoutMs: 25_000 });

    const conf = await host.confirmations(item.deliveryId);
    assert.equal(conf.count, 1, `Expected confirmation count 1 for ${item.token}`);
    deliveryReceipts.push({ index: item.index, deliveryId: item.deliveryId, kind: submitRes.kind, count: conf.count, turnId: conf.turnId });
  }

  const after5Export = await exportSession(sessionId, cwd);
  const after5Rows = projectMessages(after5Export, sessionId, cwd);
  const after5Parsed = opencode.transcript.parse(after5Rows.map(r => JSON.stringify(r)).join('\n'));
  const userIdsAfter5 = after5Rows.filter(r => r.hook_event_name === 'UserPromptSubmit').map(r => r.deliveryId);
  for (const item of queue) {
    const matches = userIdsAfter5.filter(id => id === item.deliveryId).length;
    assert.equal(matches, 1, `Native export mismatch for ${item.token}: count=${matches}`);
  }
  assert.equal(after5Parsed.turns.length, 5);
  assert.ok(after5Parsed.turns.every(t => t.status === 'completed'));

  evidence.tests.queuedDeliveries = {
    passed: true,
    count: queue.length,
    missing: 0,
    duplicates: 0,
    receipts: deliveryReceipts,
    replies: after5Parsed.turns.map(t => t.reply),
  };
  console.log('2. 5 QUEUED DELIVERIES PASS:', JSON.stringify(evidence.tests.queuedDeliveries));

  // 3. Interrupt and resume in same session/pane
  const intId = randomUUID();
  const beforeInt = await waitFor('ready before interrupt turn', async () => {
    await syncOnce();
    const st = await host.readState();
    return { ok: st.ready === true, st };
  }, { timeoutMs: 15_000 });

  const intSubmit = await host.submit({
    id: intId,
    text: 'Write a detailed 500-word essay about ocean tides, listing 20 distinct facts numbered 1 to 20.',
    generation: beforeInt.st.host.generation,
    timeoutMs: 15_000,
  });
  assert.equal(intSubmit.kind, 'confirmed', `Interrupt target submit failed: ${JSON.stringify(intSubmit)}`);

  const busySt = await waitFor('busy state for interrupt', async () => {
    await syncOnce();
    const st = await host.readState();
    return { ok: st.screen?.kind === 'busy' && st.native?.phase === 'busy', st };
  }, { timeoutMs: 15_000, intervalMs: 150 });

  // Probe host.interrupt() first (documents out-of-scope tui/providers.mjs:154 hasEmptyComposer contradiction)
  const hostInterruptProbe = await host.interrupt({
    id: randomUUID(),
    generation: busySt.st.host.generation,
    sessionId: busySt.st.native.sessionId,
    turnAt: busySt.st.native.activeSince,
    turnId: busySt.st.native.activeTurn,
    timeoutMs: 600,
  });

  // Execute OpenCode adapter's double-esc interrupt plan (esc -> "Press esc again to interrupt" -> esc)
  await exec('hc', ['keys', host.id, 'escape']);
  await sleep(150);
  await exec('hc', ['keys', host.id, 'escape']);

  const recoveredSt = await waitFor('ready after interrupt', async () => {
    await syncOnce();
    const st = await host.readState();
    return { ok: st.ready === true && st.native?.phase === 'idle' && st.native?.interruption >= 1 && st.screen?.kind === 'idle', st };
  }, { timeoutMs: 15_000 });

  const resumeId = randomUUID();
  const resumeSubmit = await host.submit({
    id: resumeId,
    text: 'Reply with only RESUMED_OK',
    generation: recoveredSt.st.host.generation,
    timeoutMs: 15_000,
  });
  assert.equal(resumeSubmit.kind, 'confirmed', `Resume submit failed: ${JSON.stringify(resumeSubmit)}`);

  await waitFor('idle after resume turn', async () => {
    await syncOnce();
    const st = await host.readState();
    return { ok: st.ready === true && st.native?.phase === 'idle' && st.screen?.kind === 'idle', st };
  }, { timeoutMs: 25_000 });

  const afterResumeExport = await exportSession(sessionId, cwd);
  const afterResumeRows = projectMessages(afterResumeExport, sessionId, cwd);
  const afterResumeParsed = opencode.transcript.parse(afterResumeRows.map(r => JSON.stringify(r)).join('\n'));
  const intTurn = afterResumeParsed.turns[5];
  const resumeTurn = afterResumeParsed.turns[6];
  assert.equal(intTurn?.status, 'interrupted', `Expected turn 6 interrupted, got ${JSON.stringify(intTurn)}`);
  assert.equal(resumeTurn?.status, 'completed', `Expected turn 7 completed, got ${JSON.stringify(resumeTurn)}`);

  evidence.tests.interruptAndResume = {
    passed: true,
    interruptedDeliveryId: intId,
    hostInterruptProbe,
    interruptMethod: 'double-esc (hc keys escape x2)',
    nativeInterruptionCount: recoveredSt.st.native.interruption,
    interruptedTurnStatus: intTurn.status,
    resumedDeliveryId: resumeId,
    resumedTurnStatus: resumeTurn.status,
    resumedReply: resumeTurn.reply,
  };
  console.log('3. INTERRUPT & RESUME PASS:', JSON.stringify(evidence.tests.interruptAndResume));

  // 4. Human draft protection (>800ms guard window)
  await waitFor('ready before draft test', async () => {
    await syncOnce();
    const st = await host.readState();
    return { ok: st.ready === true && st.screen?.empty === true, st };
  }, { timeoutMs: 15_000 });

  const humanDraft = 'human draft';
  await exec('hc', ['keys', host.id, ...humanDraft.split('').map(ch => ch === ' ' ? 'space' : ch)]);
  await sleep(1_100); // > 800ms humanPauseMs

  const draftBefore = await host.readState();
  assert.equal(draftBefore.screen?.draft, humanDraft, `Expected human draft "${humanDraft}", got ${JSON.stringify(draftBefore.screen?.draft)}`);
  assert.equal(draftBefore.ready, false, 'Expected ready=false while human draft is present');

  const blockedId = randomUUID();
  const blockedSubmit = await host.submit({ id: blockedId, text: 'Reply with only BLOCKED' });
  assert.equal(blockedSubmit.kind, 'refused', `Expected refusal with human draft, got ${JSON.stringify(blockedSubmit)}`);

  const draftAfter = await host.readState();
  assert.equal(draftAfter.screen?.draft, humanDraft, 'Human draft was modified or overwritten!');

  // Clear human draft with ctrl+u (fallback to backspaces if needed)
  await exec('hc', ['keys', host.id, 'ctrl+u']);
  await sleep(200);
  if ((await host.readState()).screen?.draft) {
    await exec('hc', ['keys', host.id, ...Array(humanDraft.length + 2).fill('backspace')]);
  }
  await sleep(950);

  const clearedSt = await waitFor('ready after clearing draft', async () => {
    await syncOnce();
    const st = await host.readState();
    return { ok: st.ready === true && st.screen?.empty === true && st.screen?.draft === '', st };
  }, { timeoutMs: 15_000 });

  const afterClearId = randomUUID();
  const afterClearSubmit = await host.submit({
    id: afterClearId,
    text: 'Reply with only DRAFT_OK',
    generation: clearedSt.st.host.generation,
    timeoutMs: 15_000,
  });
  assert.equal(afterClearSubmit.kind, 'confirmed', `Submit after clearing draft failed: ${JSON.stringify(afterClearSubmit)}`);

  await waitFor('idle after draft-clear turn', async () => {
    await syncOnce();
    const st = await host.readState();
    return { ok: st.ready === true && st.native?.phase === 'idle', st };
  }, { timeoutMs: 25_000 });

  const finalExport = await exportSession(sessionId, cwd);
  const finalRows = projectMessages(finalExport, sessionId, cwd);
  const finalParsed = opencode.transcript.parse(finalRows.map(r => JSON.stringify(r)).join('\n'));
  assert.equal(finalRows.filter(r => r.deliveryId === blockedId).length, 0, 'Blocked delivery leaked to native export');
  assert.equal(finalRows.filter(r => r.deliveryId === afterClearId && r.hook_event_name === 'UserPromptSubmit').length, 1);

  evidence.tests.humanDraftProtection = {
    passed: true,
    humanDraft,
    draftPreserved: draftAfter.screen.draft === humanDraft,
    refusal: blockedSubmit,
    blockedDeliveryLeaked: false,
    afterClearDeliveryId: afterClearId,
    afterClearKind: afterClearSubmit.kind,
    afterClearReply: finalParsed.turns.at(-1)?.reply ?? null,
  };
  console.log('4. HUMAN DRAFT PROTECTION PASS:', JSON.stringify(evidence.tests.humanDraftProtection));

  // Sanitized native export reconciliation summary
  const hookSinkLines = (await readFile(hookSink, 'utf8')).trim().split('\n').map(line => {
    const rowObj = JSON.parse(line);
    return { ...rowObj, cwd: '<isolated-temp-cwd>' };
  });
  evidence.reconciliation = {
    nativeSessionId: finalExport.info?.id,
    nativeModel: finalExport.info?.model,
    totalNativeMessages: finalExport.messages?.length ?? 0,
    projectedEventsCount: hookSinkLines.length,
    turns: finalParsed.turns.map(t => ({ index: t.index, id: t.id, status: t.status, reply: t.reply })),
    projectedEvents: hookSinkLines,
  };
} finally {
  stopPoller = true;
  await pollerPromise?.catch(() => {});
  if (host) await host.close().catch(e => console.error('close error:', e));
  await rm(root, { recursive: true, force: true });
}

// Verify pane cleanup
const { stdout: lsOut } = await exec('hc', ['ls', '--json']);
const parsedLs = JSON.parse(lsOut);
const panes = Array.isArray(parsedLs) ? parsedLs : (parsedLs.terminals ?? []);
const remaining = panes.filter(p => p.name === paneName || p.address === evidence.tests.coldStart?.paneId);
assert.equal(remaining.length, 0, `Temporary pane not cleaned up: ${JSON.stringify(remaining)}`);
evidence.cleanup = { paneCleaned: true, remainingMatchingPanes: remaining.length };

await writeFile(EVIDENCE_OUT, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log('ALL 4 LIVE TESTS PASSED & CLEANED UP. Evidence saved to tasks/PILOT-OPENCODE-TUI-1/evidence.json');
