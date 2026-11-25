import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countNativeInputs, deliveryChecks } from './invariants.mjs';

const id = '2d8c7fcd-2ce7-4796-845e-a50ec3b1661b';
const text = '[loom:' + id + ']\nrequest';
const input = { type: 'response_item', payload: { type: 'message', role: 'user',
  content: [{ type: 'input_text', text }] } };
const fixture = () => ({
  id, body: 'DONE',
  inbox: [{ received: { turnId: 'a' }, completion: { body: 'DONE' } }],
  native: [input],
  provider: [{ delivery: id }],
});

test('counts one native user input despite transcript mirrors and assistant echoes', () => {
  const sample = fixture();
  sample.native.push({ type: 'event_msg', payload: { type: 'user_message', message: text } });
  sample.native.push({ type: 'response_item', payload: { ...input.payload, role: 'assistant' } });
  assert.equal(countNativeInputs(sample.native, id), 1);
  assert.equal(deliveryChecks(sample).ok, true);
});

test('rejects duplicate native input even when the inbox has a single result', () => {
  const sample = fixture();
  sample.native.push(input);
  assert.equal(deliveryChecks(sample).ok, false);
});

test('rejects loss, duplicate inbox records, upstream replay, and disconnect before completion', () => {
  const sample = fixture();
  assert.equal(deliveryChecks({ ...sample, inbox: [] }).ok, false);
  assert.equal(deliveryChecks({ ...sample, inbox: [...sample.inbox, ...sample.inbox] }).ok, false);
  assert.equal(deliveryChecks({ ...sample, native: [] }).ok, false);
  assert.equal(deliveryChecks({ ...sample, provider: [...sample.provider, ...sample.provider] }).ok, false);
  assert.equal(deliveryChecks({ ...sample, provider: [{ delivery: id, closedBeforeRelease: true }] }).ok, false);
  assert.equal(deliveryChecks({ ...sample, inbox: [{ received: { turnId: 'a' } }] }).ok, false);
});
