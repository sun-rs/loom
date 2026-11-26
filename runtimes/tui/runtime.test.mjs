import assert from 'node:assert/strict';
import { spawnSync, mkdtemp } from '../../fixtures/test-process.mjs';
import { randomUUID } from 'node:crypto';
import { appendFile, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { UnsupportedOptionError } from '@botiverse/oar';
import { createSessionKernel } from '@botiverse/oar/kernel';
import { turnEndAfter } from '@botiverse/oar/observe';
import { screenEvidence, stopFailure } from './failure.mjs';
import { createTuiRegistry } from './index.mjs';
import { TurnTracker } from './projection.mjs';
import { jsonlTail } from './read-jsonl.mjs';
import { openNativeTui } from './transport.mjs';
import { wireText } from '../../inbox/message.mjs';
import { providers } from '../../tui/providers.mjs';

async function temp(t) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'loom-tui-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function frameEvents(kernel, kind) {
  return kernel.records().flatMap((record) => record.kind === 'frame'
    ? record.body.events.filter((event) => event.kind === kind) : []);
}

test('startup key rows and a custom status line never grant a dialog or draft the composer', () => {
  const update = '0.171.0\nEntercontinue · Escskip';
  assert.equal(providers.codex.screen.classify(update), 'awaiting-user');
  assert.deepEqual(providers.codex.screen.dialogKeys('picker', update), ['esc']);
  const migration = 'Partial heading\nEnter/Esc continue · Do not show again';
  assert.equal(providers.codex.screen.classify(migration), 'picker');
  assert.deepEqual(providers.codex.screen.dialogKeys('picker', migration), []);
  const agy = providers.agy.screen;
  const custom = '──────────\n>\n──────────\nproject on main';
  assert.equal(agy.classify(custom), 'idle');
  assert.notEqual(agy.classify(custom.replace('>\n', '> Accept-edits mode: human draft\n')), 'idle');
  assert.notEqual(agy.classify(`⠹ Working\n${custom}`), 'idle');
  assert.notEqual(agy.classify(custom.replace('project on main', 'Enter to confirm')), 'idle');
  assert.equal(agy.classify(custom.replace('project on main', 'Failed to save settings: operation not permitted')), 'error');
});

test('scoped agy hooks carry activity without a transcript locator', async t => {
  const cwd = await temp(t);
  const hookSink = join(cwd, 'hooks.jsonl');
  const transcriptPath = join(cwd, 'excluded.jsonl');
  await writeFile(transcriptPath, 'excluded record\n');
  const spec = providers.agy.start({ cwd, hookSink, boundTranscript: false });
  const workspace = spec.env.LOOM_AGY_HOOK_WORKSPACE;
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const config = JSON.parse(await readFile(join(workspace, '.agents', 'hooks.json'), 'utf8'));
  assert.match(config['loom-agy'].Stop[0].command, /agy-activity-hook\.mjs/);
  const id = randomUUID();
  const conversationId = randomUUID();
  const script = fileURLToPath(new URL('../../tui/agy-activity-hook.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, hookSink, cwd, 'PreInvocation'], {
    input: JSON.stringify({ workspacePaths: [cwd], transcriptPath, conversationId,
      invocationNum: 0, initialNumSteps: 1, lastUserInput: wireText(id, 'short prompt') }), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const event = JSON.parse(await readFile(hookSink, 'utf8'));
  assert.equal(event.deliveryId, id);
  assert.equal(event.conversationId, conversationId);
  assert.equal(event.transcriptPath, undefined);
});

function turnFixture() {
  const id = randomUUID();
  const kernel = createSessionKernel(id);
  const tracker = new TurnTracker(kernel);
  const hook = (name, fields = {}, screen = screenEvidence('──────────\n❯\n──────────\n  ? for shortcuts')) => tracker.hook({
    hook_event_name: name, session_id: id, receivedAt: Date.now(), ...fields,
  }, screen);
  const transcript = (fields) => tracker.transcript({
    uuid: randomUUID(), sessionId: id, timestamp: new Date().toISOString(), ...fields,
  }, Date.now());
  const send = (kind, input, inputId) => {
    const request = kernel.request('toRuntime', { kind, input, inputId });
    tracker.sent(request, inputId);
    kernel.respond(request.id, { kind: 'accepted' });
    return request;
  };
  return { id, kernel, tracker, hook, transcript, send };
}

test('registry preserves OAR runtimes and declares unsupported options', async () => {
  const runtime = createTuiRegistry().require('claude-tui');
  const registry = createTuiRegistry();
  for (const id of ['claude', 'codex', 'antigravity', 'opencode', 'claude-tui', 'codex-tui', 'agy-tui']) assert.equal(registry.require(id).id, id);
  const available = { kind: 'available', via: 'bundled' };
  assert.equal(runtime.execution, 'process');
  assert.equal(runtime.capabilities.steer, 'none');
  assert.equal(runtime.capabilities.queue.durable, false);
  assert.equal(runtime.sessionCapabilities(available).images, false);
  assert.equal(runtime.sessionCapabilities(available).manualCompaction.kind, 'unsupported');
  await assert.rejects(runtime.session(available, { cwd: '.', outputSchema: {} }), UnsupportedOptionError);
  await assert.rejects(runtime.session(available, { cwd: '.', resume: '--print' }), UnsupportedOptionError);
  await assert.rejects(runtime.withPlacement('shared').session(available, { cwd: '.' }), UnsupportedOptionError);
});

test('JSONL tail retains incomplete lines and multibyte characters across polls', async (t) => {
  const path = join(await temp(t), 'events.jsonl');
  const read = jsonlTail();
  const buffer = Buffer.from('{"text":"中"}\n{"seq":2}\n');
  const firstByte = buffer.indexOf(Buffer.from('中'));
  await writeFile(path, buffer.subarray(0, firstByte + 1));
  assert.deepEqual(await read(path), []);
  await appendFile(path, buffer.subarray(firstByte + 1));
  assert.deepEqual(await read(path), [{ text: '中' }, { seq: 2 }]);
  assert.deepEqual(await read(path), []);
});

test('turn boundaries use Stop first, reuse transcript text and exclude subagents', () => {
  const { kernel, tracker, hook, transcript, send } = turnFixture();
  const first = send('prompt', 'hello', 'p1');
  hook('UserPromptSubmit', { prompt_id: 'native-one', prompt: 'hello' });
  transcript({ type: 'user', promptId: 'native-one', message: { content: 'hello' } });
  const assistant = {
    type: 'assistant', uuid: 'assistant-row', message: { id: 'assistant-one', model: 'claude-sonnet-test',
      content: [{ type: 'text', text: 'from transcript' }], stop_reason: 'end_turn' },
  };
  transcript(assistant);
  transcript(assistant);
  transcript({ type: 'assistant', isSidechain: true, message: { content: 'child' } });
  hook('Stop', { prompt_id: 'native-one', last_assistant_message: 'from hook' });
  transcript({ type: 'system', subtype: 'turn_duration' });
  assert.equal(tracker.resultAfter(first.seq).finalReply, 'from hook');
  assert.deepEqual(frameEvents(kernel, 'text_delta').map((event) => event.text), ['from transcript']);
  assert.deepEqual(turnEndAfter(kernel.records(), first.seq), { kind: 'completed' });
  assert.equal(frameEvents(kernel, 'turn_ended').length, 1);

  const second = send('prompt', 'one more', 'p2');
  transcript({ type: 'user', promptId: 'native-two', message: { content: 'one more' } });
  transcript({ type: 'assistant', message: { content: 'transcript fallback', stop_reason: 'end_turn' } });
  hook('Stop', { prompt_id: 'native-two' });
  assert.equal(tracker.resultAfter(second.seq).finalReply, 'transcript fallback');

  const third = send('prompt', 'hook only', 'p3');
  hook('UserPromptSubmit', { prompt_id: 'native-three', prompt: 'hook only' });
  hook('Stop', { prompt_id: 'native-three', last_assistant_message: 'hook fallback' });
  assert.equal(tracker.resultAfter(third.seq).finalReply, 'hook fallback');
  assert.equal(frameEvents(kernel, 'text_delta').at(-1).text, 'hook fallback');
});

test('a native steer that starts a later turn waits for its own echo and boundary', () => {
  const { id, kernel, tracker, hook, transcript, send } = turnFixture();
  const first = send('prompt', 'run', 'root');
  transcript({ type: 'user', promptId: 'one', message: { content: 'run' } });
  const second = send('steer', 'later', 'steer');
  transcript({ type: 'queue-operation', operation: 'enqueue', content: 'later' });
  hook('Stop', { prompt_id: 'one', last_assistant_message: 'one done' });
  assert.deepEqual(turnEndAfter(kernel.records(), first.seq, id), { kind: 'completed' });
  assert.equal(turnEndAfter(kernel.records(), second.seq, id, 'steer'), null);
  transcript({ type: 'user', promptId: 'two', message: { content: 'later' } });
  hook('Stop', { prompt_id: 'two', last_assistant_message: 'two done' });
  assert.deepEqual(turnEndAfter(kernel.records(), second.seq, id, 'steer'), { kind: 'completed' });
  assert.equal(tracker.resultAfter(second.seq, 'steer').finalReply, 'two done');
});

test('quota and throttling are distinct and stale screens cannot fail the next turn', () => {
  const quota = screenEvidence("You've hit your weekly usage limit · resets 9pm\n❯");
  const rate = screenEvidence('API Error: 429 Too Many Requests\n❯');
  assert.equal(quota.failure?.failure, 'quota');
  assert.equal(rate.failure?.failure, 'rate_limited');
  assert.equal(stopFailure({ error: 'rate_limit', error_details: 'HTTP 429: weekly usage limit reached' }).failure, 'quota');
  assert.equal(stopFailure({ error: 'rate_limit' }).failure, 'rate_limited');

  const { kernel, tracker, hook, transcript, send } = turnFixture();
  tracker.screen(quota, Date.now());
  const first = send('prompt', 'retry later', 'p1');
  transcript({ type: 'user', promptId: 'one', message: { content: 'retry later' } });
  tracker.screen(quota, Date.now());
  tracker.screen(quota, Date.now());
  assert.equal(tracker.resultAfter(first.seq), null);
  hook('StopFailure', { prompt_id: 'one', error: 'rate_limit' }, rate);
  assert.equal(tracker.resultAfter(first.seq).outcome.failure, 'rate_limited');

  tracker.screen(rate, Date.now());
  const second = send('prompt', 'fresh failure', 'p2');
  transcript({ type: 'user', promptId: 'two', message: { content: 'fresh failure' } });
  tracker.screen(quota, Date.now());
  assert.equal(tracker.resultAfter(second.seq), null);
  tracker.screen(quota, Date.now());
  assert.equal(tracker.resultAfter(second.seq).outcome.failure, 'quota');
  hook('StopFailure', { prompt_id: 'two', error: 'rate_limit' }, quota);
  assert.equal(frameEvents(kernel, 'turn_ended').length, 2);
});

test('interrupt is based on native transcript or a fresh interruption screen', () => {
  const { kernel, tracker, transcript, send } = turnFixture();
  const first = send('prompt', 'tool work', 'p1');
  transcript({ type: 'user', promptId: 'one', message: { content: 'tool work' } });
  transcript({ type: 'user', promptId: 'one', interruptedMessageId: 'm1',
    message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } });
  assert.deepEqual(turnEndAfter(kernel.records(), first.seq), { kind: 'aborted' });
  assert.equal(tracker.resultAfter(first.seq).finalReply, null);
  const second = send('prompt', 'manual fallback', 'p2');
  tracker.interruptSent();
  tracker.screen(screenEvidence('──────────\n❯\n──────────\n  ? for shortcuts'), Date.now());
  assert.equal(tracker.resultAfter(second.seq), null);
  tracker.screen(screenEvidence('  ⎿  Interrupted · What should Claude do instead?\n──────────\n❯\n──────────\n  ? for shortcuts'), Date.now());
  assert.equal(tracker.resultAfter(second.seq), null);
  tracker.screen(screenEvidence('  ⎿  Interrupted · What should Claude do instead?\n──────────\n❯\n──────────\n  ? for shortcuts'), Date.now());
  assert.deepEqual(turnEndAfter(kernel.records(), second.seq), { kind: 'aborted' });
});


test('the shared OAR runtime opens each provider and records a confirmed input', async t => {
  const root = await temp(t);
  for (const cli of ['claude', 'codex', 'agy']) {
    const hookSink = join(root, `${cli}.jsonl`);
    const sessionId = randomUUID();
    const event = fields => appendFile(hookSink,
      JSON.stringify({ cwd: root, session_id: sessionId, receivedAt: Date.now(), ...fields }) + '\n');
    const opened = [];
    const runtime = createTuiRegistry({ [cli]: {
      command: '/usr/bin/true',
      async open(options) {
        opened.push(options.cli);
        return {
          id: `pane-${cli}`, sessionId, hookSink, transport: 'loom-pty',
          readState: async () => ({ ready: true, host: { generation: 4 }, native: { phase: 'idle' } }),
          async submit({ id, text, generation }) {
            assert.equal(generation, 4);
            const turnId = randomUUID();
            const agy = cli === 'agy';
            await event({ hook_event_name: agy ? 'PreInvocation' : 'UserPromptSubmit',
              turn_id: turnId, deliveryId: id, prompt: wireText(id, text) });
            await event({ hook_event_name: 'Stop', turn_id: turnId, fullyIdle: true,
              last_assistant_message: 'test reply', finalReply: 'test reply' });
            return { kind: 'confirmed' };
          },
          async close() { return { exit_code: 0 }; },
        };
      },
    } }).require(`${cli}-tui`);
    const session = await runtime.session({ kind: 'available', via: 'bundled' }, { cwd: root });
    try {
      const queued = await session.queue('withdraw');
      assert.equal(queued.kind, 'accepted');
      assert.equal((await session.withdraw(queued.request.body.inputId)).kind, 'accepted');
      const accepted = await session.prompt('through the shared host');
      assert.equal(accepted.kind, 'accepted');
      assert.equal(turnEndAfter(session.records(), accepted.seq, session.id)?.kind, 'completed');
      assert.equal((await session.prompt('again', { inputId: accepted.request.body.inputId })).kind, 'rejected');
      assert.deepEqual(opened, [cli]);
    } finally {
      await session.dispose();
    }
    assert.equal((await session.prompt('after exit')).code, 'runtime_exited');
  }
});

test('a wrapper that exits before spawning the native CLI falls back to a manual pane', async t => {
  const root = await temp(t);
  const fakeHc = join(root, 'hc');
  const output = join(root, 'pane.json');
  await writeFile(fakeHc, `#!${process.execPath}
import { readFileSync, writeFileSync } from 'node:fs';
const out = ${JSON.stringify(output)};
const [command, ...args] = process.argv.slice(2);
if (command === 'run') {
  const wrapped = args.some(arg => arg.endsWith('/tui/loom-pty'));
  const address = wrapped ? 't1' : 't2';
  const name = args[args.indexOf('--name') + 1];
  writeFileSync(out, JSON.stringify({ address, name, state: wrapped ? 'finished' : 'live' }));
}
if (!['run', 'get'].includes(command)) process.exit(2);
console.log(readFileSync(out, 'utf8'));
`, { mode: 0o700 });
  const bindings = [];
  const session = await openNativeTui({ cli: 'claude', cwd: root, command: '/usr/bin/true', hcCommand: fakeHc,
    stateDir: root, recordBinding: binding => bindings.push(binding.transport) });
  assert.deepEqual(bindings, ['loom-pty', 'plain-hc']);
  assert.equal(session.id, 't2');
  assert.deepEqual(session.binding, { transport: 'plain-hc', reason: 'loom-pty-start-failed' });
  assert.equal((await session.readState()).ready, false);
  assert.equal(session.submit, undefined);
});
