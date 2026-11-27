import assert from 'node:assert/strict';
import { mkdtempSync, spawnSync } from '../fixtures/test-process.mjs';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
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

test('invariant [persistence] grant reservations, claims and expirations survive reloading state', t => {
  const project = fixture(t);
  let time = Date.now();
  const events = new Map();
  const open = () => hostGrants(project, { now: () => time, notify: (...incoming) => {
    for (const event of incoming) events.set(event.id, event);
  } });
  const row = { project, task: 'PROBE', wave: 'W', addr: 'first' };
  const second = { ...row, addr: 'second' };
  const third = { ...row, addr: 'third' };
  const grant = open().grant(project, { target: row.task, reason: 'Fixture', ttlMs: 2000, uses: 2, wave: false, write: [] }, 'super');
  assert.equal(open().prepare(row, false).id, grant.id);
  assert.equal(open().permitted(row, grant.id), false);
  open().reserve(row, false, grant.id);
  open().reserve(second, false, grant.id);
  assert.equal(open().permitted(row, grant.id), true);
  assert.equal(open().active(row, grant.id), false);
  assert.throws(() => open().reserve(third, false, grant.id), { code: 'host-grant-exhausted' });
  open().release(second, grant.id);
  assert.equal(open().permitted(second, grant.id), false);
  assert.equal(open().claim(row, false, grant.id).id, grant.id);
  assert.equal(open().claim(row, false, grant.id).id, grant.id);
  open().reserve(third, false, grant.id);
  open().claim(third, false, grant.id);
  assert.equal(open().active(row, grant.id), true);
  assert.equal(open().active(second, grant.id), false);
  time += 2001;
  open().sweep();
  assert.equal(open().active(row, grant.id), false);
  assert.throws(() => open().reserve(third, false, grant.id), { code: 'host-grant-expired' });
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

test('macOS Claude host boundary allows named paths and blocks ungranted writes',
  { skip: process.platform !== 'darwin' || nestedSeatbeltLimited }, t => {
  const project = fixture(t);
  const outside = fixture(t);
  const temporary = fixture(t);
  const granted = join(outside, 'output');
  mkdirSync(granted);
  const tmp = join(temporary, 't');
  mkdirSync(tmp);
  const row = { cli: 'claude', addr: `oar-${randomUUID()}`, cwd: project, hostGrant: { write: [granted] } };
  const launcher = hostWriteBoundary(project, row, { TMPDIR: tmp }, '/usr/bin/touch');
  assert.equal(spawnSync(launcher, [join(granted, 'granted')]).status, 0);
  assert.equal(spawnSync(launcher, [join(project, 'worktree')]).status, 0);
  assert.notEqual(spawnSync(launcher, [join(outside, 'ungranted')]).status, 0);
  assert.notEqual(spawnSync(launcher, [join(project, '.project', 'ungranted')]).status, 0);
});

test('unconfined host grants bypass Loom Seatbelt for agy and claude while default grants keep it',
  { skip: process.platform !== 'darwin' || nestedSeatbeltLimited }, t => {
  const project = fixture(t);
  const temporary = fixture(t);
  for (const cli of ['agy', 'claude']) {
    const confinedTmp = join(temporary, `${cli}-confined`, 't');
    const unconfinedTmp = join(temporary, `${cli}-unconfined`, 't');
    mkdirSync(confinedTmp, { recursive: true });
    mkdirSync(unconfinedTmp, { recursive: true });
    const confinedRow = { cli, addr: `oar-${randomUUID()}`, cwd: project, hostGrant: { write: [] } };
    const unconfinedRow = { cli, addr: `oar-${randomUUID()}`, cwd: project, hostGrant: { write: [], unconfined: true } };
    const confinedLauncher = hostWriteBoundary(project, confinedRow, { TMPDIR: confinedTmp }, process.execPath);
    const unconfinedLauncher = hostWriteBoundary(project, unconfinedRow, { TMPDIR: unconfinedTmp }, process.execPath);
    assert.notEqual(confinedLauncher, process.execPath);
    assert.match(readFileSync(confinedLauncher, 'utf8'), /exec \/usr\/bin\/sandbox-exec -p /);
    assert.equal(unconfinedLauncher, process.execPath);
  }
  const codexTmp = join(temporary, 'codex-default', 't');
  mkdirSync(codexTmp, { recursive: true });
  assert.equal(hostWriteBoundary(project, { cli: 'codex', addr: `oar-${randomUUID()}`, cwd: project, hostGrant: { write: [] } },
    { TMPDIR: codexTmp }, process.execPath), process.execPath);
});

test('invariant [persistence] unconfined host grant persists unconfined flag and audit notices', t => {
  const project = fixture(t);
  let time = Date.now();
  const events = new Map();
  const open = () => hostGrants(project, { now: () => time, notify: (...incoming) => {
    for (const event of incoming) events.set(event.id, event);
  } });
  const row = { project, task: 'CELL-SRT', wave: 'W', addr: 'first' };
  const second = { ...row, addr: 'second' };
  const grant = open().grant(project, { target: row.task, reason: 'Nested srt test', ttlMs: 2000, uses: 1, wave: false, write: [], unconfined: true }, 'super');
  assert.equal(grant.unconfined, true);
  assert.equal(open().prepare(row, false).unconfined, true);
  open().reserve(row, false, grant.id);
  assert.equal(open().claim(row, false, grant.id).unconfined, true);
  assert.throws(() => open().reserve(second, false, grant.id), { code: 'host-grant-exhausted' });
  time += 2001;
  open().sweep();
  const notices = [...events.values()];
  for (const type of ['host-tier-grant', 'host-tier-used', 'host-tier-refused', 'host-tier-expired']) {
    const notice = notices.find(event => event.type === type);
    assert.ok(notice, `missing ${type}`);
    assert.equal(notice.unconfined, true);
    assert.match(notice.text, /unconfined/i);
  }
});
