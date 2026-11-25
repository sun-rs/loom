import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnHeadless } from '../../runtimes/oar/index.mjs';

const cwd = '/Users/sun/Code/exp-relay/mode-bench/_control/live-controls';
mkdirSync(cwd);
const worker = await spawnHeadless({
  cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', cwd,
  project: cwd, task: 'controls', wave: 'control',
  prompt: '只回复 OAR_CONTROL_ONE，不调用工具。',
}, { firstTurnOptions: { timeoutMs: 180_000 } });
const sessionId = worker.index.sessionId;
const readEvents = () => readFileSync(worker.eventsPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
try {
  assert.equal((await worker.firstTurn).outcome?.kind, 'completed');
  const followup = await worker.send('复述上一轮的标记并加上 _TWO。只回复拼接后的标记，不调用工具。', { timeoutMs: 180_000 });
  assert.equal(followup.outcome?.kind, 'completed');
  assert.equal(worker.index.sessionId, sessionId);
  assert.equal(readEvents().find(e => e.type === 'turn-end' && e.turn === 2)?.finalReply?.trim(), 'OAR_CONTROL_ONE_TWO');
  const pending = worker.send('只在当前目录用终端执行 sleep 15，等执行结束后再回复。', { timeoutMs: 180_000 });
  pending.catch(() => {});
  for (let i = 0; i < 150 && !readEvents().some(e => e.type === 'turn-start' && e.turn === 3); i++) await delay(100);
  assert.ok(readEvents().some(e => e.type === 'turn-start' && e.turn === 3));
  const stop = await worker.interrupt();
  assert.equal(stop.kind, 'accepted');
  assert.equal((await pending).outcome?.kind, 'aborted');
  assert.equal(readEvents().find(e => e.type === 'turn-end' && e.turn === 3)?.finalReply, null);
} finally {
  await worker.close();
}
assert.ok(worker.index.endedAt && worker.index.transcriptPath);
writeFileSync(`${cwd}/summary.json`, JSON.stringify({
  sessionId, indexPath: worker.indexPath, path: worker.index.transcriptPath,
  continued: true, interrupted: true,
}) + '\n');
console.log('Codex continuation and interrupt verified', sessionId);
