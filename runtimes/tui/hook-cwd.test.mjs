import assert from 'node:assert/strict';
import { execFileSync, mkdtemp } from '../../fixtures/test-process.mjs';
import { copyFile, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withClaudeTranscriptStops } from '../../relay/sources.mjs';
import { nativeState } from '../../tui/native.mjs';
import { providers } from '../../tui/providers.mjs';

async function temp(t) {
  const cwd = await mkdtemp(join(await realpath(tmpdir()), 'loom-hook-cwd-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
}

const rowsOf = text => text.trimEnd().split('\n').map(JSON.parse);

test('replays the pilot Claude hook gap and requires a final reply and all tool results', async t => {
  const cwd = await temp(t);
  const sessionId = 'hook-cwd-regression';
  const transcriptPath = join(cwd, sessionId + '.jsonl');
  const hookSink = join(cwd, 'hooks.jsonl');
  const fixture = name => readFile(new URL('./fixtures/hook-cwd/' + name, import.meta.url), 'utf8');
  const nativeLog = (await fixture('transcript.jsonl')).replaceAll('__CWD__', cwd);
  const hooksLog = (await fixture('hooks.jsonl')).replaceAll('__CWD__', cwd).replaceAll('__TRANSCRIPT__', transcriptPath);
  await writeFile(hookSink, hooksLog);
  const hooks = rowsOf(hooksLog);
  const native = () => nativeState(providers.claude, { cwd, evidenceRoot: cwd, sessionId, hookSink });
  const rows = rowsOf(nativeLog);
  const write = rows => writeFile(transcriptPath, rows.map(row => JSON.stringify(row) + '\n').join(''));

  const toolResult = rows.findIndex(row => row.message?.content?.[0]?.type === 'tool_result' && row.cwd !== cwd);
  assert.notEqual(toolResult, -1);
  await write(rows.filter((_, index) => index !== toolResult));
  assert.equal((await native().read()).phase, 'busy');
  assert.equal(withClaudeTranscriptStops({ cwd }, hooks, sessionId).length, hooks.length);

  const summary = rows.findIndex(row => row.subtype === 'stop_hook_summary');
  await write(rows.slice(0, summary + 1));
  assert.equal((await native().read()).source, 'transcript');
  assert.equal(withClaudeTranscriptStops({ cwd }, hooks, sessionId).at(-1).source, 'claude transcript stop_hook_summary');

  await write(rows);
  const state = await native().read();
  assert.equal(state.phase, 'idle');
  assert.equal(state.source, 'transcript');
  const stop = withClaudeTranscriptStops({ cwd }, hooks, sessionId).at(-1);
  assert.equal(stop.hookGap, true);
  assert.equal(stop.prompt_id, hooks[0].prompt_id);
  assert.equal(stop.source, 'claude transcript turn_duration');
  assert.equal(stop.last_assistant_message, 'PASS fixture gate packet');

  const withoutStart = withClaudeTranscriptStops({ cwd }, hooks.slice(1), sessionId).at(-1);
  assert.equal(withoutStart.hookGap, true);
  assert.equal(withoutStart.deliveryId, hooks[0].deliveryId);
  assert.equal(withoutStart.prompt_id, undefined);
});

test('Claude start emits no hooks under CCP while hook-shim still resolves active release', async t => {
  const cwd = await temp(t);
  const shim = join(cwd, 'hook.mjs');
  const sink = join(cwd, 'events.jsonl');
  const sessionId = '87654321-4321-4321-8321-abcdef123456';
  const launchRoot = fileURLToPath(new URL('../..', import.meta.url));
  await copyFile(new URL('./hook-shim.mjs', import.meta.url), shim);
  const spec = await providers.claude.start({ cwd, hookSink: sink, hookRunner: shim, resume: sessionId });
  assert.equal(spec.argv.includes('--settings'), false, 'Claude under CCP must not inject hooks in --settings');
  assert.deepEqual(spec.argv.slice(1, 3), ['--resume', sessionId]);
  const args = [shim, sink, sessionId, cwd];

  const invoke = (payload = {}) => execFileSync(process.execPath, args, {
    env: { ...process.env, LOOM_HOOK_RELEASE: launchRoot },
    input: JSON.stringify({ hook_event_name: 'Stop', cwd: join(cwd, '.project'), session_id: sessionId, ...payload }),
  });
  invoke({ agent_id: 'subagent' });
  invoke({ session_id: 'foreign-session' });
  invoke();
  const [stop] = rowsOf(await readFile(sink, 'utf8'));
  assert.equal(stop.cwd, join(cwd, '.project'));
  assert.equal(stop.hook_event_name, 'Stop');
  assert.equal(rowsOf(await readFile(sink, 'utf8')).length, 1);

  invoke({ hook_event_name: 'SessionStart', session_id: 'replacement' });
  const changed = await nativeState(providers.claude, { cwd, sessionId, evidenceRoot: cwd, hookSink: sink }).read();
  assert.equal(changed.identityChanged, true);
  assert.equal(changed.sessionId, sessionId);

  const updated = join(cwd, 'new');
  await mkdir(join(updated, 'runtimes/tui'), { recursive: true });
  await writeFile(join(updated, 'runtimes/tui/capture-hook.mjs'),
    "import { appendFileSync } from 'node:fs'; appendFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)) + '\\n');");
  await writeFile(join(cwd, 'release.json'), JSON.stringify({ current: { root: updated } }));
  invoke();
  assert.deepEqual(rowsOf(await readFile(sink, 'utf8')).at(-1), [sessionId, cwd]);
});

test('Claude TUI tracks turn start, delivery, completion, and compaction purely from session transcript with zero hooks', async t => {
  const root = await temp(t);
  const cwd = join(root, 'workspace');
  const configDir = join(root, '.claude');
  const sessionId = '11111111-2222-4333-8444-555555555555';
  const bucket = join(configDir, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));
  const transcriptPath = join(bucket, `${sessionId}.jsonl`);
  const hookSink = join(root, 'empty-hooks.jsonl');
  await mkdir(cwd, { recursive: true });
  await mkdir(bucket, { recursive: true });
  const delivery = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const t0 = Date.parse('2026-11-27T10:00:00.000Z');
  const native = nativeState(providers.claude, { cwd, configDir, evidenceRoot: root, sessionId, hookSink, boundTranscript: true });

  // Before any user turn, transcript does not exist yet; screenStartup permits readiness.
  assert.equal(providers.claude.screenStartup, true);
  assert.equal((await native.read()).phase, undefined);

  // User message written to Claude transcript confirms delivery and sets busy without hooks.
  const userRow = {
    type: 'user', sessionId, cwd, uuid: 'u1', timestamp: new Date(t0).toISOString(),
    message: { role: 'user', content: `[loom:${delivery}]\nHello under CCP` },
  };
  await writeFile(transcriptPath, JSON.stringify(userRow) + '\n');
  const busy = await native.read();
  assert.equal(busy.phase, 'busy');
  assert.equal(busy.source, 'transcript');
  assert.equal(busy.transcriptPath, transcriptPath);
  assert.equal(native.confirmations(delivery).count, 1);

  const prevConfig = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = configDir;
  t.after(() => {
    if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevConfig;
  });
  const midEvents = withClaudeTranscriptStops({ cwd, created_ms: t0 - 1000 }, [], sessionId);
  assert.equal(midEvents.length, 1);
  assert.equal(midEvents[0].hook_event_name, 'UserPromptSubmit');
  assert.equal(midEvents[0].deliveryId, delivery);

  // Assistant reply + turn_duration closes the turn and yields the final reply.
  const assistantRow = {
    type: 'assistant', sessionId, cwd, uuid: 'a1', timestamp: new Date(t0 + 1000).toISOString(),
    message: { id: 'm1', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: 'DONE under CCP' }] },
  };
  const endRow = {
    type: 'system', subtype: 'turn_duration', sessionId, cwd, uuid: 's1',
    timestamp: new Date(t0 + 1050).toISOString(), isSidechain: false, isMeta: false, durationMs: 1050,
  };
  const compactRow = {
    type: 'system', subtype: 'compact_boundary', sessionId, cwd, uuid: 'c1',
    timestamp: new Date(t0 + 2000).toISOString(), isSidechain: false,
  };
  await writeFile(transcriptPath, [userRow, assistantRow, endRow, compactRow].map(r => JSON.stringify(r) + '\n').join(''));
  const done = await native.read();
  assert.equal(done.phase, 'idle');
  const finalEvents = withClaudeTranscriptStops({ cwd, created_ms: t0 - 1000 }, [], sessionId);
  assert.deepEqual(finalEvents.map(e => e.hook_event_name), ['UserPromptSubmit', 'Stop', 'PostCompact']);
  assert.equal(finalEvents[1].last_assistant_message, 'DONE under CCP');
  assert.equal(finalEvents[1].deliveryId, delivery);
});
