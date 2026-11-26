import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processTable, projectSessionMemory } from './processes.mjs';

test('targeted process lookup retries ETIMEDOUT without falling back to a full system scan', async () => {
  let attempts = 0;
  const rows = await processTable([123, 123, 456], async (bin, args, options) => {
    assert.equal(bin, '/bin/ps');
    assert.deepEqual(args.slice(0, 2), ['-p', '123,456']);
    assert.equal(options.timeout, 2000);
    if (++attempts === 1) throw Object.assign(new Error('test timeout'), { code: 'ETIMEDOUT' });
    return { stdout: '123 22 22 501 Thu Nov 26 08:33:21 2026 /opt/bin/node\n' };
  });
  assert.equal(rows.get(123).executable, '/opt/bin/node');
  assert.equal(attempts, 2);
  await assert.rejects(processTable([123], async () => {
    throw Object.assign(new Error('test timeout'), { code: 'ETIMEDOUT' });
  }), { code: 'process-enumeration-retry' });
});

test('session memory sums verified process trees and counts each PID once per project', async () => {
  const live = (pid, ppid, pgid, rssKiB, uid = process.getuid()) =>
    ({ pid, ppid, pgid, rssKiB, uid, started: 'Thu Nov 26 10:00:00 2026', executable: '/bin/fixture' });
  const owner = live(10, 1, 10, 100);
  const table = new Map([owner, live(11, 10, 10, 200), live(12, 11, 12, 300),
    live(13, 1, 10, 400), live(14, 10, 10, 500, process.getuid() + 1)].map(row => [row.pid, row]));
  assert.deepEqual(await projectSessionMemory('project', [
    { project: 'project', root: { pid: 10, identity: owner, detached: true } },
    { project: 'project', root: { pid: 11 } },
    { project: 'project', root: { pid: 12, identity: { ...owner, pid: 12, started: 'reused PID' } } },
    { project: 'released', dormant: true },
  ], async () => table), [
    { project: 'project', rssKiB: 1000, measuredSessions: 2, unavailableSessions: 1 },
    { project: 'released', rssKiB: 0, measuredSessions: 0, unavailableSessions: 0 },
  ]);
});
