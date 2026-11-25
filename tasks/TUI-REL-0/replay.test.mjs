import assert from 'node:assert/strict';
import { test } from 'node:test';
import agy from '../../adapters/agy/index.mjs';
import claude from '../../adapters/claude/index.mjs';
import codex from '../../adapters/codex/index.mjs';
import { replay } from './replay.mjs';

test('replays existing screen fixtures and current hc captures without false input eligibility', () => {
  const rows = replay();
  assert.ok(rows.length >= 65);
  assert.deepEqual(rows.filter(row => row.falseInput || row.unknownWithKeys), []);
  assert.ok(rows.some(row => row.provider === 'claude' && row.actual === 'compacting'));
  assert.ok(rows.some(row => row.provider === 'agy' && row.actual === 'compacting'));
  assert.ok(rows.some(row => row.provider === 'codex' && row.actual === 'rate-limit'));
});

test('selection keys require a supported live footer and an aimed cursor', () => {
  for (const { screen } of [claude, codex, agy]) {
    const text = 'startup text with no recognizable input';
    assert.deepEqual(screen.inspect(text), { kind: 'unknown', code: 'UNKNOWN', evidence: { screen: text } });
    assert.deepEqual(screen.dialogKeys('unknown', text), []);
    assert.deepEqual(screen.dialogKeys('trust-dialog', text), []);
    assert.deepEqual(screen.dialogKeys('picker', text), []);
  }
  const twoCursors = 'Folder access\n› 1. Trust and continue\n› 2. Back\nenter continue · esc back';
  assert.deepEqual(codex.screen.dialogKeys('trust-dialog', twoCursors), []);
});

test('blank continuation lines in a composer do not count as an empty prompt', () => {
  assert.equal(claude.screen.classify('──────────\n❯\n  \n──────────\n? for shortcuts'), 'unknown');
  assert.equal(agy.screen.classify('──────────\n>\n  \n──────────\n? for shortcuts'), 'unknown');
});
