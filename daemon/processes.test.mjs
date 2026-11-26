import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processLiveness, processTable } from './processes.mjs';

test('a missing ps row or EPERM leaves liveness unknown; ESRCH and PID reuse establish death', () => {
  const owner = { pid: 123, started: 'original', uid: process.getuid(), executable: '/test/node' };
  const error = code => () => { throw Object.assign(new Error(code), { code }); };
  assert.equal(processLiveness(owner, undefined, () => true), 'unknown');
  assert.equal(processLiveness(owner, undefined, error('EPERM')), 'unknown');
  assert.equal(processLiveness(owner, undefined, error('ESRCH')), 'dead');
  assert.equal(processLiveness(owner, { ...owner, started: 'reused' }), 'dead');
  assert.equal(processLiveness(owner, owner), 'alive');
  assert.equal(processLiveness({ pid: owner.pid }, undefined, error('ESRCH')), 'unknown');
});

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
