import assert from 'node:assert/strict';
import { mkdtempSync, spawnSync } from '../fixtures/test-process.mjs';
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hostGrants, hostWritePaths } from './host-grants.mjs';
import { hostWriteBoundary } from './host-worker.mjs';
import { nestedSeatbeltLimited } from './sandbox-test-capability.mjs';

function fixture(t) {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-host-grant-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.project', 'loomd'), { recursive: true });
  return project;
}

test('invariant persistence grant claims and expirations survive reloading state', t => {
  const project = fixture(t);
  let time = Date.now();
  const events = new Map();
  const open = () => hostGrants(project, { now: () => time, notify: (...incoming) => {
    for (const event of incoming) events.set(event.id, event);
  } });
  const row = { project, task: 'PROBE', wave: 'W', addr: 'first' };
  const grant = open().grant(project, { target: row.task, reason: 'Fixture', ttlMs: 2000, uses: 2, wave: false, write: [] }, 'super');
  assert.equal(open().prepare(row, false).id, grant.id);
  assert.equal(open().active(row, grant.id), false);
  assert.equal(open().reserve(row, false, grant.id).id, grant.id);
  assert.equal(open().reserve({ ...row, addr: 'second' }, false).id, grant.id);
  assert.equal(open().reserve(row, false, grant.id).id, grant.id);
  assert.throws(() => open().reserve({ ...row, addr: 'third' }, false), { code: 'host-grant-exhausted' });
  assert.equal(open().active(row, grant.id), true);
  assert.equal(open().active({ ...row, addr: 'third' }, grant.id), false);
  time += 2001;
  open().sweep();
  assert.equal(open().active(row, grant.id), false);
  assert.throws(() => open().reserve({ ...row, addr: 'third' }, false), { code: 'host-grant-expired' });
  assert.ok([...events.values()].some(event => event.type === 'host-tier-expired' && event.at === time));
  assert.equal([...events.values()].filter(event => event.type === 'host-tier-used').length, 2);
});

test('host write grants resolve through ancestors and reject aliases into protected state', t => {
  const project = fixture(t);
  const alias = join(project, 'alias');
  symlinkSync(join(project, '.project'), alias);
  assert.deepEqual(hostWritePaths(project, [join(project, 'output', 'new')]), [join(project, 'output', 'new')]);
  assert.throws(() => hostWritePaths(project, [join(alias, 'new')]), { code: 'invalid-arguments' });
  assert.throws(() => hostWritePaths(project, ['/']), { code: 'invalid-arguments' });
});

test('macOS host boundary allows named paths and blocks ungranted writes',
  { skip: process.platform !== 'darwin' || nestedSeatbeltLimited }, t => {
  const project = fixture(t);
  const outside = fixture(t);
  const temporary = fixture(t);
  const granted = join(outside, 'output');
  mkdirSync(granted);
  const tmp = join(temporary, 't');
  mkdirSync(tmp);
  const row = { cli: 'codex', addr: `oar-${randomUUID()}`, cwd: project, hostGrant: { write: [granted] } };
  const launcher = hostWriteBoundary(project, row, { TMPDIR: tmp }, '/usr/bin/touch');
  assert.equal(spawnSync(launcher, [join(granted, 'granted')]).status, 0);
  assert.equal(spawnSync(launcher, [join(project, 'worktree')]).status, 0);
  assert.notEqual(spawnSync(launcher, [join(outside, 'ungranted')]).status, 0);
  assert.notEqual(spawnSync(launcher, [join(project, '.project', 'ungranted')]).status, 0);
});
