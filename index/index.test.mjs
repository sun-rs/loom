import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { openIndex, roles } from './index.mjs';

function scratch(t) {
  const path = mkdtempSync(join(tmpdir(), 'loom-index-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function put(root, name, text) {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

test('registers all roles and queries persisted metadata for evidence and handover', t => {
  const cwd = scratch(t);
  const path = join(cwd, 'db/index.sqlite');
  const index = openIndex(path);
  assert.deepEqual(index.query(), []);
  assert.equal(index.update('t404', { model: 'missing' }), null);
  for (const role of roles) index.register({ addr: `t-${role}`, project: 'P', role, backend: 'tui', cli: 'claude', cwd });
  const successor = {
    addr: 't-next', project: 'P', role: 'leader', backend: 'headless', cli: 'agy', runtimeId: 'antigravity',
    parent: 't-leader', cwd, baseCommit: 'abc123', transcriptPath: join(cwd, 'leader.jsonl'), startedAt: 100,
  };
  assert.deepEqual(index.register(successor), index.register(successor));
  assert.throws(() => index.register({ ...successor, project: 'Q' }), /already registered/);
  assert.throws(() => index.update(successor.addr, { account: 'private' }), /null account/);
  assert.throws(() => index.update(successor.addr, { endedAt: 99 }), /precedes/);
  assert.equal(index.update(successor.addr, { sessionId: 'next', endedAt: 110 }).endedAt, 110);

  const reopened = openIndex(path);
  assert.equal(reopened.query({ project: 'P' }).length, 5);
  assert.equal(reopened.query({ project: 'Q' }).length, 0);
  const [row] = reopened.query({ project: 'P', parent: 't-leader', runtimeId: 'antigravity' });
  assert.equal(row.cli, 'agy');
  assert.equal(row.sessionId, 'next');
  assert.equal(row.baseCommit, 'abc123');
  assert.equal(row.transcriptPath, successor.transcriptPath);
  assert.equal(row.account, null);
});

test('imports relay registrations, legacy hooks and OAR sidecars without replacing known bindings', async t => {
  const cwd = scratch(t);
  const index = openIndex(join(cwd, 'index.sqlite'));
  const transcriptPath = join(cwd, 'rollout-local.jsonl');
  put(cwd, '.project/workers.md', [
    '| T1 | t1 | codex(model-x/high) | dispatched | | wave=W |',
    '| T1 | t1 | codex(model-x/high) | done | result | wave=W |',
  ].join('\n'));
  put(cwd, '.project/relay/events/t1.jsonl', [
    JSON.stringify({ cwd, hook_event_name: 'Stop', session_id: 's1', transcript_path: transcriptPath }),
    JSON.stringify({ cwd, hook_event_name: 'Stop', session_id: 'child', agent_id: 'other' }),
    '{"unfinished":',
  ].join('\n'));
  put(cwd, '.project/relay/events/t-leader.jsonl', JSON.stringify({
    addr: 't-leader', role: 'leader', cwd, payload: { conversationId: 'lead', transcriptPath: join(cwd, 'leader.jsonl') },
  }));
  put(cwd, '.project/relay/events/oar-demo.jsonl', JSON.stringify({ addr: 'oar-demo', type: 'turn-end', at: 140 }));
  put(cwd, '.project/relay/oar/oar-demo.json', JSON.stringify({
    addr: 'oar-demo', role: 'auditor', cli: 'codex', runtimeId: 'codex', sessionId: 'oar', startedAt: 120, endedAt: 170,
  }));

  const rows = await index.importRelay(cwd, { project: 'P' });
  assert.equal(rows.length, 3);
  assert.deepEqual(await index.importRelay(cwd, { project: 'P' }), rows);
  const [worker] = index.query({ task: 'T1', project: 'P' });
  assert.equal(worker.cli, 'codex');
  assert.equal(worker.model, 'model-x');
  assert.equal(worker.wave, 'W');
  assert.equal(worker.transcriptPath, transcriptPath);
  assert.equal(worker.endedAt, null);
  assert.equal(index.query({ role: 'leader' })[0].cli, 'agy');
  const [oar] = index.query({ backend: 'headless' });
  assert.equal(oar.endedAt, 170);
  assert.equal(oar.runtimeId, 'codex');

  assert.equal(index.update('t1', { sessionId: 's2' }).transcriptPath, null);
  await index.importRelay(cwd, { project: 'P' });
  assert.equal(index.query({ addr: 't1' })[0].transcriptPath, null);

  put(cwd, '.project/workers.md', 'T0 | t0 | agy | dispatched |\nT1 | t1 | codex | done |');
  await assert.rejects(index.importRelay(cwd, { project: 'Q' }), /another project/);
  assert.deepEqual(index.query({ addr: 't0' }), []);
});
