import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { publish } from '../inbox/store.mjs';
import { main } from './cli.mjs';
import { generateBrief, maxBriefTokens, recordLifecycle, retainedRecords } from './index.mjs';
import { estimateTokens } from '../lib/token-budget.mjs';

const newIndex = (...rows) => ({ query: filter => rows.filter(row => row.project === filter.project) });
const session = (addr, fields = {}) => ({ project: 'P', role: 'leader', addr, cli: 'claude', sessionId: addr, ...fields });
const headings = ['会话链', '最近 L1', '在途 worker', 'relay 波次', '收件箱', '卡死告警', 'MISMATCH', '未提交改动'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const stamp = n => new Date(1000 * n).toISOString();

async function workspace(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'loom-handover-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function put(dir, path, data) {
  const file = join(dir, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, typeof data === 'string' ? data : JSON.stringify(data));
  return file;
}

function turn(id, time = 1, text = id) {
  return [
    { type: 'user', uuid: 'user-' + id, timestamp: stamp(time), message: { content: `任务 ${text}` } },
    { type: 'assistant', timestamp: stamp(time), message: { id, stop_reason: 'end_turn', content: [{ type: 'text', text: `结果 ${text}` }] } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n';
}

test('all unavailable components degrade independently, including the index and git', async t => {
  const projectDir = await workspace(t);
  const index = { query() { throw new Error('index unavailable'); } };
  const output = await generateBrief({ role: 'super', project: 'P', projectDir, index });
  assert.equal(output.addr, null);
  assert.match(output.brief, /^# super · P/);
  for (const title of headings) assert.match(output.brief, new RegExp(`## ${title}\n不可用`));
  assert.match(output.brief, /## 项目章程\n\.project\/charter\.md · 缺失/);
  assert.match(output.brief, /## 裁决账本\n\.project\/rulings\.md · 缺失/);

  await put(projectDir, '.project/workers.md', 'T8 | t8 | claude | dispatched | | wave=W8\n');
  await put(projectDir, '.project/relay/state.json', '{truncated');
  const known = await generateBrief({ role: 'super', project: 'P', projectDir, index });
  assert.match(known.brief, /## 在途 worker\nT8 t8 dispatched W8/);
  assert.match(known.brief, /## relay 波次\n不可用/);
});

test('projects charter topics and verbatim numbered rulings relevant to the current task or cited by the role', async t => {
  const projectDir = await workspace(t);
  await put(projectDir, '.project/charter.md', [
    '# 项目章程', '## 目标', '- 交付工单队列', '## 非目标', '- 历史迁移',
    '## 红线', '- 生产数据只读', '## 验收要点', '- 对比两次回执',
  ].join('\n'));
  await put(projectDir, '.project/workers.md', 'ACTIVE-7 | t7 | codex | dispatched | | wave=W1\n');
  await put(projectDir, '.project/inbox/state.json', {
    messages: [{ id: 'latest', target: 't1', phase: 'queued', text: '沿用裁决 12' }],
  });
  await put(projectDir, '.project/rulings.md', [
    '# 用户裁决账本', '## 11 · 上周', '> 无关的旧工单',
    '## 12 · 周一', '- 来源原件', '> 重新读原件。',
    '## 13 · 周二', '> ACTIVE-7：保留  原样。', '> 第二行，仍是原话。',
    '## 14 · 周三', '> 另一条新裁决',
  ].join('\n'));
  const { brief } = await generateBrief({ role: 'leader', project: 'P', projectDir, index: newIndex(session('t1')), locate: false });
  assert.match(brief, /## 项目章程\n\.project\/charter\.md\n目标 · 交付工单队列\n非目标 · 历史迁移\n红线 · 生产数据只读\n验收 · 对比两次回执/);
  assert.match(brief, /## 裁决账本\n\.project\/rulings\.md\n裁决 12\n> 重新读原件。\n裁决 13\n> ACTIVE-7：保留  原样。\n> 第二行，仍是原话。/);
  assert.doesNotMatch(brief, /无关的旧工单|另一条新裁决|来源原件/);
});

test('retains the rulings pointer and marks a linked ledger as unreadable', async t => {
  const projectDir = await workspace(t);
  const other = await workspace(t);
  const unowned = await put(other, 'unrelated.md', '## 99\n> 外部原文');
  await mkdir(join(projectDir, '.project'));
  await symlink(unowned, join(projectDir, '.project/rulings.md'));
  const { brief } = await generateBrief({ role: 'auditor', project: 'P', projectDir, index: newIndex(), locate: false });
  assert.match(brief, /## 项目章程\n\.project\/charter\.md · 缺失/);
  assert.match(brief, /## 裁决账本\n\.project\/rulings\.md · 不可读/);
  assert.doesNotMatch(brief, /外部原文/);
});

test('projects the parent chain, latest adapter turns, inbox, relay, watch, claims and git', async t => {
  const projectDir = await workspace(t);
  execFileSync('git', ['init', '-q', '--template=', projectDir]);
  await put(projectDir, 'ship.txt', 'pending');
  const old = session('t1', { parent: 't0', startedAt: 1000, transcriptPath: await put(projectDir, 'old.jsonl', turn('old')) });
  const parent = session('t0', { role: 'super', transcriptPath: await put(projectDir, 'super.jsonl', turn('super-other')) });
  const current = session('t2', { parent: 't1', startedAt: 2000, transcriptPath: await put(projectDir, 'new.jsonl', turn('new', 2)) });
  await put(projectDir, '.project/workers.md', 'T1 | t3 | codex(verified) | dispatched | | wave=W1\nT2 | t4 | agy | done | DONE | wave=W2\n');
  await put(projectDir, '.project/relay/state.json', { waves: { 'wave:W1': { members: ['T1/t3'] }, 'wave:W2': { closed: true, members: ['T2/t4'] } }, outbox: [] });
  await put(projectDir, '.project/watch/events.jsonl', [
    { type: 'stuck', addr: 't3', incidentId: 'incident', at: 3321, reason: 'idle-without-stop' },
    { type: 'recovered', addr: 't3', incidentId: 'incident', at: 3322 },
  ].map(row => JSON.stringify(row)).join('\n') + '\n');
  await put(projectDir, '.project/evidence/T5-7.json', { task: 'T5', turn: 7, endedAt: 1234,
    claims: [{ status: 'MISMATCH', text: '全绿', reason: '存在跳测' }, { status: 'MATCH', reason: 'already verified' }] });
  const newest = { id: '00000000-0000-4000-8000-000000000001', target: { addr: 't2' }, from: { addr: 't9' },
    phase: 'queued', text: 'queued message', createdAt: 2000 };
  publish(projectDir, newest);
  await put(projectDir, '.project/inbox/state.json', { messages: [
    { ...newest, phase: 'received', text: 'waiting answer' },
    { id: 'other', phase: 'pending', to: 't66', text: 'different role' },
    { id: 'answer', phase: 'received', target: { addr: 't1' }, completion: { body: 'answered' }, text: 'already answered' },
    { id: 'pending', phase: 'pending', target: { addr: 't1' }, text: 'pending message' },
  ] });
  const result = await generateBrief({ role: 'leader', project: 'P', projectDir, index: newIndex(old, parent, current) });
  assert.equal(result.addr, 't2');
  assert.match(result.brief, /t2 ← t1 ← t0/);
  assert.match(result.brief, /t2#1 .*回复 结果 new\nt1#1 .*回复 结果 old/);
  assert.doesNotMatch(result.brief, /super-other|different role|already answered|queued message/);
  assert.match(result.brief, /T1 t3 dispatched W1/);
  assert.match(result.brief, /W1 open 1 人\nW2 closed 1 人/);
  assert.match(result.brief, /未回复 t9→t2 waiting answer/);
  assert.match(result.brief, /待投 外部→t1 pending message/);
  assert.match(result.brief, /idle-without-stop 已结束/);
  assert.match(result.brief, /T5#7 MISMATCH 存在跳测/);
  assert.match(result.brief, /\?\? ship\.txt/);
});

test('caps the entire brief on UTF-8 boundaries while retaining sections and reporting broken ancestry', async t => {
  const projectDir = await workspace(t);
  const project = '项目👩🏽‍💻'.repeat(200);
  const transcriptPath = await put(projectDir, 'heavy.jsonl', Array.from({ length: 8 }, (_, i) =>
    turn('heavy-' + i, i + 1, '中文🌅'.repeat(100))).join(''));
  const current = session('t1', { project, parent: 't0-missing', transcriptPath });
  const index = newIndex(current, session('t0-missing', { project: 'another project' }));
  const answers = Array.from({ length: 15 }, (_, i) => ({ id: `id${i}`, phase: 'queued', to: 't1', text: '覆核👋'.repeat(200) }));
  await put(projectDir, '.project/inbox/state.json', { messages: answers });
  await put(projectDir, '.project/workers.md', Array.from({ length: 8 }, (_, i) => `TASK${i} | worker${i} | agy | dispatched | | wave=W0${i}\n`).join(''));
  await put(projectDir, '.project/charter.md', ['目标', '非目标', '红线', '验收']
    .map(label => '## ' + label + '\n- ' + '章程长段👋'.repeat(500)).join('\n'));
  await put(projectDir, '.project/rulings.md', [1, 2, 3].map(number =>
    '## ' + number + '\n> ' + '账本长段🌅'.repeat(500)).join('\n'));
  const output = await generateBrief({ role: 'leader', project, projectDir, index, turns: 5 });
  assert(estimateTokens(output.brief) <= maxBriefTokens);
  assert.doesNotMatch(output.brief, /\ufffd/);
  assert.match(output.brief, /不可用（parent t0-missing 缺失）/);
  for (const title of headings) assert(output.brief.includes(`## ${title}\n`));
  assert.match(output.brief, /## 项目章程\n\.project\/charter\.md\n目标 · .*?\n非目标 · .*?\n红线 · .*?\n验收 · /);
  assert.match(output.brief, /## 裁决账本\n\.project\/rulings\.md\n裁决 3\n> /);
  for (const n of [8, 7, 6, 5, 4]) assert(output.brief.includes(`t1#${n} `));
  assert.doesNotMatch(output.brief, /t1#[123] /);
});

test('archives a rotating native session with immutable, retriable lifecycle records', async t => {
  const root = await workspace(t);
  const initial = turn('before');
  const original = await put(root, 'claude.jsonl', initial);
  const row = session('claude-role', { transcriptPath: original });
  const event = { hook_event_name: 'PreCompact', session_id: row.sessionId, eventId: 'pre', at: 10 };
  const batch = await Promise.all([recordLifecycle(root, row, event), recordLifecycle(root, row, event)]);
  assert.equal(batch[0].status, 'recorded');
  assert.deepEqual(batch[0], batch[1]);
  assert.equal(batch[0].record.sha256, sha256(initial));
  assert.equal(batch[0].record.kind, 'pre-compact');
  assert.equal(batch[0].record.path, original);
  const before = join(root, batch[0].record.archivePath);
  assert.equal((await stat(before)).mode & 0o777, 0o400);
  assert.equal(await readFile(before, 'utf8'), initial);

  const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary' });
  await appendFile(original, boundary + '\n' + turn('after', 2));
  const compact = await recordLifecycle(root, row, { ...JSON.parse(boundary), uuid: 'after', at: 20 });
  assert.equal(compact.record.kind, 'compact');
  assert.notEqual(compact.record.sha256, batch[0].record.sha256);
  assert.equal(compact.record.sha256, sha256(await readFile(original)));
  await recordLifecycle(root, row, { type: 'shift', eventId: 'shift', at: 21 });
  await recordLifecycle(root, row, { hook_event_name: 'SessionEnd', eventId: 'end', at: 30 });
  assert.equal((await readdir(join(root, '.project', 'archive'))).length, 2);
  assert.deepEqual((await retainedRecords(root, row)).map(value => value.kind), ['session-end', 'shift', 'compact', 'pre-compact']);
  await rm(original);
  const brief = await generateBrief({ role: 'leader', project: 'P', projectDir: root, index: newIndex(row), locate: false });
  assert.match(brief.brief, /回复 结果 after/);
  assert.match(brief.brief, /回复 结果 before/);
});

test('retains stable Codex logs by reference and recognizes Codex and agy lifecycle events', async t => {
  const projectDir = await workspace(t);
  const path = join(projectDir, 'rollout.jsonl');
  const row = session('c1', { cli: 'codex', transcriptPath: path });
  const event = { method: 'item/completed', params: { threadId: 'c1', item: { type: 'contextCompaction', id: 'item' } }, at: 10 };
  const missing = await recordLifecycle(projectDir, row, event, { locate: false });
  assert.equal(missing.status, 'unavailable');
  await writeFile(path, '{"type":"compacted"}\n');
  const done = await recordLifecycle(projectDir, row, event, { locate: false });
  assert.equal(done.record.kind, 'compact');
  assert.equal(done.record.archivePath, null);
  await assert.rejects(readdir(join(projectDir, '.project', 'archive')), { code: 'ENOENT' });
  assert.equal(await recordLifecycle(projectDir, row, { ...event, sessionId: 'wrong' }), null);
  assert.equal(await recordLifecycle(projectDir, { ...row, role: 'worker' }, event), null);

  const full = await put(projectDir, 'agy/transcript_full.jsonl', '{"type":"full"}\n');
  const short = await put(projectDir, 'agy/transcript.jsonl', '{"type":"short"}\n');
  const agy = session('agy-role', { role: 'super', cli: null, runtimeId: 'antigravity', transcriptPath: short });
  assert.equal(await recordLifecycle(projectDir, agy, { kind: 'compaction_ended', outcome: 'failed' }), null);
  const agyRecord = await recordLifecycle(projectDir, agy, { kind: 'compaction_ended', outcome: 'completed', at: 20 });
  assert.equal(agyRecord.record.provider, 'agy');
  assert.equal(agyRecord.record.path, full);
  assert.equal(agyRecord.record.sha256, sha256(await readFile(full)));
});

test('does not follow a linked native file and keeps a missing parent or transcript visible', async t => {
  const projectDir = await workspace(t);
  const transcript = await put(projectDir, 'unrelated.jsonl', turn('unrelated'));
  const link = join(projectDir, 'link.jsonl');
  await symlink(transcript, link);
  const row = session('t1', { parent: 't2', transcriptPath: link });
  const other = session('t2', { parent: 't1', role: 'auditor' });
  assert.equal((await recordLifecycle(projectDir, row, { type: 'session-end' }, { locate: false })).status, 'unavailable');
  const output = await generateBrief({ role: 'leader', project: 'P', projectDir, index: newIndex(row, other), locate: false });
  assert.match(output.brief, /parent 循环 t1/);
  assert.match(output.brief, /原生记录缺失/);
  assert.doesNotMatch(output.brief, /unrelated/);
});

test('CLI queues the previous role holder’s brief once and reports an unavailable queue with the brief', async t => {
  const projectDir = await workspace(t);
  await put(projectDir, '.project/rulings.md', '## 7\n> 先核对原件。');
  const index = newIndex(session('t1'), session('t2', { parent: 't1' }), session('t3', { startedAt: 20 }));
  const output = [];
  const requests = [];
  const opts = { projectDir, index, locate: false, emit: result => output.push(result), queue: request => {
    requests.push(request);
    return { id: 'test-delivery', mode: 'queue', status: 'queued' };
  } };
  assert.equal(await main(['leader', '--project', 'P'], opts), 0);
  assert.equal(requests.length, 0);
  assert.equal(await main(['leader', '--project', 'P', '--to', 't2'], opts), 0);
  assert.equal(output.at(-1).addr, 't1');
  assert.match(output.at(-1).brief, /## 项目章程\n\.project\/charter\.md · 缺失/);
  assert.match(output.at(-1).brief, /## 裁决账本\n\.project\/rulings\.md\n裁决 7\n> 先核对原件。/);
  assert.deepEqual(requests, [{ project: 'P', projectDir, from: 't1', to: 't2', mode: 'queue', brief: output.at(-1).brief }]);
  assert.equal(await main(['leader', '--project', 'P', '--to', 't2'], {
    ...opts, queue: () => { throw new Error('收件箱不可用'); },
  }), 1);
  assert.equal(output.at(-1).error.code, 'unavailable');
  assert.equal(output.at(-1).brief, requests[0].brief);
  assert.equal(await main(['worker', '--project', 'P'], opts), 2);
});
