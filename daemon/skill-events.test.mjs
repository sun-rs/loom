import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliverySkillEvents } from './skill-events.mjs';

const select = (role, fields = {}) => deliverySkillEvents({
  role, message: {}, requestFor: () => undefined, senderRole: () => undefined, resultTags: [], ...fields,
});

test('managed Super notices use typed decision, escalation, recovery and close modules', () => {
  for (const [event, names] of [
    [{ type: 'needs-decision' }, ['needs-decision']],
    [{ type: 'needs-decision', reason: 'blocking-disagreement' }, ['needs-decision', 'escalation']],
    [{ type: 'needs-decision', reason: 'audit-returns' }, ['needs-decision', 'escalation']],
    [{ type: 'blocked-escalation' }, ['needs-decision', 'escalation']],
    [{ type: 'red-escalation', reason: 'protected-file' }, ['escalation']],
    [{ type: 'delivery-uncertain' }, ['delivery-uncertain']],
    [{ type: 'delivery-stalled', reason: 'uncertain' }, ['delivery-uncertain']],
    [{ type: 'needs-decision', reason: 'payload-mismatch' }, ['needs-decision', 'delivery-uncertain']],
    [{ type: 'host-tier-expired' }, ['host-tier']],
    [{ type: 'needs-decision', kind: 'worker-tier-request' }, ['needs-decision', 'host-tier']],
    [{ type: 'project-completed' }, ['close']],
  ]) assert.deepEqual(select('super', { notices: [event] }).names, names);
});

test('senior failures, blocked work, handover and hard red facts select eligible modules', () => {
  for (const role of ['leader', 'auditor']) {
    assert.deepEqual(select(role, { resultTags: ['FAILED', 'BLOCKED'] }).names, ['needs-decision', 'senior-recovery']);
    assert.deepEqual(select(role, { message: { waveKind: 'timeout' } }).names, ['senior-recovery']);
    assert.deepEqual(select(role, { message: { continuationKind: 'timeout' } }).names, ['senior-recovery']);
    assert.deepEqual(select(role, { message: { workerResultsFailed: true } }).names, ['senior-recovery']);
    assert.deepEqual(select(role, { message: { stuckOf: 'id' } }).names, ['senior-recovery']);
    assert.deepEqual(select(role, { notices: [{ type: 'needs-decision', reason: 'handover-work-unstarted' }] }).names,
      ['needs-decision', 'senior-recovery']);
    assert.deepEqual(select(role, { observed: [{ type: 'worker-handoff', reason: 'fabrication' }] }).names,
      ['senior-recovery', 'containment']);
    assert.deepEqual(select(role, { observed: [{ type: 'fence-hit' }] }).names, ['containment']);
  }
});

test('Auditor rejections from active send and automatic replies reach the Leader', () => {
  for (const message of [{ text: 'REJECT\nCARD X' }, { text: 'Stop X', requestedMode: 'interrupt' }]) {
    assert.deepEqual(select('leader', { message, senderRole: () => 'auditor' }).names, ['reject-routing']);
    assert.deepEqual(select('leader', { message, senderRole: () => 'worker' }).names, []);
  }
  const result = select('leader', { message: { replyTo: 'old' },
    requestFor: () => ({ gatePacket: 'G', completion: { body: 'REJECT\nCARD X' } }) });
  assert.deepEqual(result, { names: ['reject-routing'], gateRejection: true });
});

test('continuation and denial cues stay scoped to the Worker', () => {
  for (const workerResume of ['REJECT', 'BLOCKED']) {
    const fields = { message: { workerResume }, workerDenied: true };
    assert.deepEqual(select('worker', fields).names, ['worker-denied', 'worker-resume']);
    assert.deepEqual(select('leader', fields).names, []);
  }
});
