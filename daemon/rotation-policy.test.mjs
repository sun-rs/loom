import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rotationPolicy, switchDensity } from './rotation-policy.mjs';
import { rotationSettings } from '../lib/rotation-settings.mjs';

test('v2 switching applies alternative thresholds and relaxes single-mainline dispatches', () => {
  const at = 100_000_000;
  const config = rotationSettings({ rotation: { mode: 'v2', densityRequiresCompaction: false,
    subsystemPrefixes: { 'src/api': 'api' } } });
  const usage = { compactions: 0, afterCompaction: [] };
  const cards = Array.from({ length: 11 }, (_, i) => ({ at, card: String(i), mainline: 'goal', paths: ['src/api/index.js'] }));
  assert.equal(switchDensity(cards, usage, config, 'codex', at).hit, false);
  assert.equal(switchDensity(cards.map((item, i) => ({ ...item, mainline: String(i) })), usage, config, 'codex', at).hit, true);
  assert.equal(switchDensity(cards.slice(0, 5).map((item, i) => ({ ...item, paths: [`unit-${i}/index.js`] })),
    usage, config, 'codex', at).hit, true);
  const afterCompaction = Array.from({ length: 5 }, (_, i) => ({ at: at - i }));
  assert.equal(switchDensity([], { compactions: 5, afterCompaction }, config, 'claude', at).hit, true);
  assert.equal(switchDensity([], { compactions: 5, afterCompaction }, config, 'codex', at).hit, true);
  assert.equal(switchDensity([], { compactions: null, afterCompaction: [] }, config, 'agy', at).compact, null);
  const docs = cards.slice(0, 5).map((item, i) => ({ ...item, paths: [`docs/unit-${i}/detail.md`, 'ledger/rulings.txt'] }));
  assert.equal(switchDensity(docs, usage, config, 'codex', at).subsystems, 0);
  assert.equal(switchDensity([{ ...cards[0], paths: new Set(cards[0].paths) }, { ...cards[1], paths: {} }],
    usage, config, 'codex', at).subsystems, 1);
  assert.equal(switchDensity(cards, { compactions: 5, afterCompaction }, { ...config, densityRequiresCompaction: true },
    'codex', at).hit, false);
  assert.equal(switchDensity(cards.map((item, i) => ({ ...item, mainline: String(i) })),
    { compactions: 5, afterCompaction }, { ...config, densityRequiresCompaction: true }, 'codex', at).hit, true);
});

function policyFixture(t, options = {}) {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-rotation-policy-'));
  t.after(() => rmSync(project, { force: true, recursive: true }));
  mkdirSync(join(project, '.project', 'loomd'), { recursive: true });
  execFileSync('/usr/bin/git', ['init', '-q', project]);
  const row = { role: 'leader', addr: 'LEADER', project, cwd: project, endedAt: null, startedAt: 100 };
  const rows = [row];
  const jobs = new Map([[row.addr, { row }]]);
  const notices = [], proposals = [];
  const policy = rotationPolicy(project, {
    now: () => 1_000, sessions: { rows: () => rows, jobs, routeParent: () => row }, mail: { messages: [] },
    notifications: { add: note => notices.push(note), list: () => [] },
    policy: () => ({ rotation: { mode: 'v2', ...options } }),
    propose: (_, reason) => (proposals.push(reason), true),
  });
  const observe = (cwd, state = 'idle', safe = true) => policy.observe(row, { cwd, compactions: 0, afterCompaction: [] }, { state }, safe);
  return { project, row, rows, jobs, notices, proposals, policy, observe };
}

test('v2 moving within a Git project is a clean window, while changing Git roots can trigger rotation', t => {
  const { project, observe, proposals } = policyFixture(t);
  const subdir = join(project, 'feature');
  mkdirSync(subdir);
  observe(project);
  observe(subdir);
  assert.deepEqual(proposals, []);
  execFileSync('/usr/bin/git', ['init', '-q', subdir]);
  observe(subdir);
  assert.deepEqual(proposals, ['project-change']);
});

test('v2 density by itself records strict mode and defers evaluation until an idle boundary', t => {
  const { project, row, rows, jobs, notices, proposals, policy, observe } = policyFixture(t, { cards: 1 });
  for (const number of [1, 2]) {
    const worker = { role: 'worker', addr: `W${number}`, parent: row.addr, project, task: `T${number}`,
      startedAt: 500 + number, wave: `Wave${number}` };
    rows.push(worker);
    jobs.set(worker.addr, { row: worker, prompt: 'Create `src/task.mjs`.' });
  }
  observe(project, 'busy', false);
  assert.ok(policy.snapshot(project).roles[0].strict.density);
  assert.deepEqual(notices, []);
  observe(project);
  observe(project);
  assert.deepEqual(notices.map(note => note.reason), ['rotation-evaluation']);
  assert.deepEqual(proposals, []);
});
