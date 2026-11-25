import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { locate as locateCodex } from '../../adapters/codex/locate.mjs';
import { locate as locateAgy } from '../../adapters/agy/transcript.mjs';

const bench = '/Users/sun/Code/exp-relay/mode-bench';
const grader = join(homedir(), '.exp-graders/exp-relay');
// Same metering reference as exp-relay/tokens.py.
const { parseTranscript } = await import(pathToFileURL(join(grader, 'reference/lib/schema.mjs')));
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const jsonl = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const args = process.argv.slice(2);
const names = args.length ? args : readdirSync(join(bench, '_control')).filter(name => /^(codex|agy)-(tui|headless)-[12]$/.test(name));
for (const name of names) {
  assert.match(name, /^(codex|agy)-(tui|headless)-[12]$/);
  const dir = join(bench, '_control', name);
  const run = json(join(dir, 'run.json'));
  assert.equal(run.cwd, join(bench, name));
  let sessionId, endedAt, eventReply, terminal, model, effort, index, eventUsage;
  if (run.mode === 'tui') {
    terminal = json(join(dir, 'terminal.json')).address;
    const rows = jsonl(join(run.cwd, '.project/relay/events', `${terminal}.jsonl`));
    const stop = rows.find(row => row.cwd === run.cwd && row.receivedAt >= run.startedAt && (
      run.cli === 'agy' ? row.fullyIdle === true && row.conversationId : row.hook_event_name === 'Stop' && !row.agent_id
    ));
    assert.ok(stop, `No completed native Stop for ${name}`);
    sessionId = stop.session_id ?? stop.conversationId;
    endedAt = stop.receivedAt;
    eventReply = stop.last_assistant_message;
  } else {
    index = json(join(dir, 'session.json'));
    assert.equal(index.cwd, run.cwd);
    ({ sessionId, model } = index);
    const events = jsonl(join(bench, '.project/relay/events', `${index.addr}.jsonl`));
    const end = events.find(e => e.type === 'turn-end' && e.turn === 1);
    assert.ok(end, `No native turn-end for ${name}`);
    endedAt = end.at;
    eventReply = end.finalReply;
    eventUsage = {};
    for (const event of events.filter(e => e.type === 'usage' && e.turn === 1)) {
      for (const [field, delta] of Object.entries(event.usage)) eventUsage[field] = (eventUsage[field] ?? 0) + delta;
    }
    effort = json(join(dir, 'outcome.json')).effort;
  }
  assert.match(sessionId, /^[0-9a-f-]{36}$/i);
  const path = run.cli === 'codex' ? locateCodex({ sessionId, cwd: run.cwd }) : locateAgy({ sessionId });
  assert.ok(path && !/(\/provider-homes\/|\/memories[^/]*\/|\/\.env)/.test(path));
  assert.equal(realpathSync(path), path);
  const text = readFileSync(path, 'utf8');
  const session = parseTranscript(text);
  assert.equal(session.provider, run.cli);
  const turn = session.turns[0];
  assert.ok(turn, `Missing first turn for ${name}`);
  const nativeModels = new Set();
  if (run.cli === 'agy') {
    for (const line of text.split('\n')) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (row?.source === 'MODEL' && row.type === 'PLANNER_RESPONSE' && row.model) nativeModels.add(row.model);
    }
  }
  const accept = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(grader, 'accept.test.mjs')], {
    cwd: run.cwd, env: { ...process.env, DIR: run.cwd, TMPDIR: join(bench, '_tmp') }, encoding: 'utf8',
  });
  if (accept.error) throw accept.error;
  writeFileSync(join(dir, 'accept.tap'), accept.stdout + accept.stderr);
  const cases = [...accept.stdout.matchAll(new RegExp(`^(ok|not ok) \\d+ - (${run.task} [^\\n]+)`, 'gm'))]
    .map(([, status, title]) => ({ status, title }));
  assert.equal(cases.length, run.task === 'T1' ? 4 : 3, `Hidden tests missing for ${name}`);
  const usage = turn.usage;
  const metrics = {
    name, task: run.task, terminal, sessionId, path, model: model ?? run.model, effort: effort ?? run.effort,
    nativeModels: [...nativeModels], promptHash: createHash('sha256').update(readFileSync(join(dir, 'prompt.txt'))).digest('hex'),
    status: turn.status, startedAt: run.startedAt, endedAt, seconds: (endedAt - run.startedAt) / 1000,
    calls: usage.calls, fresh: usage.inputTokens - usage.cachedInputTokens, cached: usage.cachedInputTokens,
    cacheWrite: usage.cacheWriteInputTokens, output: usage.outputTokens, total: usage.inputTokens + usage.outputTokens,
    firstLine: turn.reply?.split('\n')[0], replyMatches: eventReply === undefined ? undefined : turn.reply === eventReply,
    indexMatches: index && index.transcriptPath === path && Number.isFinite(index.endedAt),
    usageMatches: eventUsage && ['inputTokens', 'cachedInputTokens', 'outputTokens']
      .every(field => (eventUsage[field] ?? 0) === usage[field]),
    passed: cases.filter(c => c.status === 'ok').length, cases,
  };
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
  console.log(JSON.stringify(metrics));
}
