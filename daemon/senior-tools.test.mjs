import assert from 'node:assert/strict';
import { execFileSync, mkdtempSync } from '../fixtures/test-process.mjs';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { providers } from '../tui/providers.mjs';
import { managedEnvironment, releaseRoot } from './release.mjs';
import { hookRunner, managedHookPath } from './tui.mjs';
import { seniorToolEnvironment, seniorToolEvents } from './senior-tools.mjs';
import { seniorToolCategory } from '../lib/senior-tool-guard.mjs';
import openCodePlugin from '../adapters/opencode/prompt-events/index.js';

test('senior hook gates are launch scoped and record denials without disabling targeted reads', async t => {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-senior-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.project/loomd/sessions'), { recursive: true });
  writeFileSync(join(project, '.project/policy.json'), '{}');
  writeFileSync(join(project, 'source.mjs'), 'export {};\n');
  const row = { role: 'leader', addr: 'leader-fixture' };
  const guard = seniorToolEnvironment(project, row);
  assert.deepEqual(seniorToolEnvironment(project, { ...row, role: 'super' }), {});
  assert.deepEqual(seniorToolEnvironment(project, { ...row, role: 'worker' }), {});
  const env = { ...process.env, ...managedEnvironment(project, row.addr), ...guard, LOOM_HOOK_RELEASE: releaseRoot };
  const sessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const sink = join(project, '.project/hooks.jsonl');
  const command = { command: 'npm test' };
  const invoke = (file, args, input, toolEnv = env) => execFileSync(process.execPath, [file, ...args], {
    input: JSON.stringify(input), env: toolEnv, encoding: 'utf8', cwd: project,
  });
  for (const cli of ['claude', 'codex']) {
    const args = cli === 'claude' ? [sink, sessionId, project] : [sink];
    const input = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: command, session_id: sessionId, cwd: project };
    const result = JSON.parse(invoke(hookRunner(project, cli), args, input));
    assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(invoke(managedHookPath(project, cli), args, { ...input, tool_name: 'Read',
      tool_input: { file_path: 'source.mjs', limit: 200 } }), '');
  }
  const agyHook = hookRunner(project, 'agy');
  const payload = { conversationId: sessionId, cwd: project, toolCall: { name: 'run_command', args: { CommandLine: 'git merge candidate' } } };
  const agyArgs = [sink, project, 'PreToolUse', join(project, '.project/binding'), sessionId, 'deny-questions'];
  assert.equal(JSON.parse(invoke(agyHook, agyArgs, payload)).decision, 'deny');
  assert.equal(JSON.parse(invoke(agyHook, agyArgs, { ...payload, toolCall: { name: 'ask_question' } })).decision, 'deny');
  const spec = providers.agy.start({ cwd: project, hookSink: sink, hookRunner: agyHook, allowNativeQuestions: false });
  const staging = spec.env.LOOM_AGY_HOOK_WORKSPACE;
  t.after(() => rmSync(staging, { recursive: true, force: true }));
  assert.ok(spec.argv.includes(staging));
  assert.equal(env.LOOM_BIN, join(project, '.project/loomd/bin/loom'));
  assert.equal(seniorToolCategory('Bash', { command: 'git diff --stat && "$LOOM_BIN" status' }, project, project), undefined);
  assert.equal(seniorToolCategory('Bash', { command: 'rg defect .' }, project, project), 'source-search');
  assert.equal(seniorToolCategory('Bash', { command: 'while true; do "$LOOM_BIN" state leader; done' }, project, project), 'state-poll');

  const saved = Object.fromEntries(Object.keys(guard).map(key => [key, process.env[key]]));
  Object.assign(process.env, guard);
  try {
    let evaluate;
    await openCodePlugin.setup({ location: { directory: project }, tool: { hook() {} },
      permission: { hook: (_, callback) => { evaluate = callback; } } });
    const permission = { action: 'shell', resources: ['pytest'], effect: 'allow' };
    evaluate(permission);
    assert.equal(permission.effect, 'deny');
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  assert.deepEqual(seniorToolEvents(project, row.addr).map(event => event.category),
    ['test-build', 'test-build', 'git-integration', 'test-build']);
  writeFileSync(join(project, '.project/policy.json'), '{"roles":{"leader":{"toolGuard":false}}}');
  assert.deepEqual(seniorToolEnvironment(project, row), {});
});
