import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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

test('a stable Claude hook keeps its arguments and selects the active release', async t => {
  const cwd = await temp(t);
  const shim = join(cwd, 'hook.mjs');
  const sink = join(cwd, 'events.jsonl');
  const sessionId = '87654321-4321-4321-8321-abcdef123456';
  const launchRoot = fileURLToPath(new URL('../..', import.meta.url));
  await copyFile(new URL('./hook-shim.mjs', import.meta.url), shim);
  const spec = await providers.claude.start({ cwd, hookSink: sink, hookRunner: shim, resume: sessionId });
  const settings = JSON.parse(spec.argv[spec.argv.indexOf('--settings') + 1]);
  const args = settings.hooks.Stop[0].hooks[0].args;
  assert.deepEqual(args, [shim, sink, sessionId, cwd]);

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
