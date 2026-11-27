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
import { recordSeniorToolDenial, seniorToolCategory } from '../lib/senior-tool-guard.mjs';
import { literalShellArgv, parseOverrideFile, parseOverrideLines, seniorCommandKey, seniorOverrideReason } from '../lib/senior-command.mjs';
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

test('senior command keys normalize literal argv and keep shell syntax distinct', () => {
  const literal = `/usr/bin/printf   %s "a b" 'hello' ''`;
  assert.deepEqual(literalShellArgv(literal), ['/usr/bin/printf', '%s', 'a b', 'hello', '']);
  assert.equal(seniorCommandKey(literal), seniorCommandKey(`/usr/bin/printf %s a\\ b h"ell"o ""`));
  assert.notEqual(seniorCommandKey("/usr/bin/printf '%s' '$HOME'"), seniorCommandKey('/usr/bin/printf %s "$HOME"'));
  assert.notEqual(seniorCommandKey('/usr/bin/seq 1 5 | /usr/bin/head'), seniorCommandKey('/usr/bin/seq 1 5 ; /usr/bin/head'));
  assert.notEqual(seniorCommandKey('/usr/bin/seq 1 5'), seniorCommandKey('/usr/bin/seq 1 6'));
  assert.equal(seniorOverrideReason('核对本轮候选的验证结果'), '核对本轮候选的验证结果');
  assert.equal(seniorOverrideReason('  Explain  this retry  '), 'Explain this retry');
  assert.equal(seniorOverrideReason('probe'), undefined);
});

test('senior guard allows read-only loom/.project/git-metadata pipes and bounded git-show slices while blocking heavy or unsafe commands', t => {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-senior-allow-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.project/evidence'), { recursive: true });
  mkdirSync(join(project, '.project/notes'), { recursive: true });
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(join(project, '.project/rulings.md'), 'R1\nR2\n');
  writeFileSync(join(project, '.project/evidence/T1.json'), '{"ok":true}\n');
  writeFileSync(join(project, 'src/app.mjs'), 'export const a = 1;\n');

  const allow = cmd => assert.equal(seniorToolCategory('Bash', { command: cmd }, project, project), undefined, `expected allowed: ${cmd}`);
  const deny = (cmd, category) => assert.equal(seniorToolCategory('Bash', { command: cmd }, project, project), category, `expected denied (${category}): ${cmd}`);

  // Reasonable Auditor queries observed in pilot-cell & pilot-2
  allow('"$LOOM_BIN" status | grep -oE "abc" | head -8');
  allow('"$LOOM_BIN" cost 2>/dev/null | jq -c ".byRole"');
  allow('"$LOOM_BIN" notifications --history | jq -r ".notifications[]" | cut -c1-200');
  allow('"$LOOM_BIN" hist --role auditor --turns 20 --level L1 | grep -E "^第" | cut -c1-160');
  allow('cd "$LOOM_PROJECT" && ls -t .project/evidence | grep T1 | head -8');
  allow('tail -n +18 .project/rulings.md');
  allow('jq -c ".ok" .project/evidence/T*.json');
  allow('wc -l .project/evidence/*.json');
  allow('grep -rnE "ok" .project/evidence/*.json | cut -c1-200');
  allow('git diff-tree -r --stat abc123 def456');
  allow('git diff --name-only abc123 def456 | grep -v "^$"');
  allow('git log --oneline -5 | cut -c1-120');
  allow('git rev-parse --short HEAD; git status --short | head -3; date -u +%FT%TZ');
  allow('git show abc123:src/app.mjs | sed -n "1,200p"');
  allow('git show abc123:src/app.mjs | sed -n "69,103p" | cut -c1-200');
  allow('git show abc123:src/app.mjs | head -n 80');
  allow('git show abc123:src/app.mjs | head -50');
  allow('head -50 src/app.mjs');

  // Heavy / unsafe commands that must remain denied
  deny('grep -rn "foo" src/', 'source-search');
  deny('rg foo', 'source-search');
  deny('git grep foo abc123', 'source-search');
  deny('git diff abc123 def456 -- src/app.mjs', 'source-read');
  deny('git show abc123:src/app.mjs', 'source-read');
  deny('git show abc123:src/app.mjs | sed -n "1,201p"', 'source-read');
  deny('git show abc123:src/app.mjs | head -n 201', 'source-read');
  deny('git show abc123 | head -n 50', 'source-read');
  deny('git show abc123:.env | head -n 10', 'source-read');
  deny('git show abc123:../secret.txt | head -n 10', 'source-read');
  deny('git show abc123:src/app.mjs | grep export', 'source-read');
  deny('jq -c "." src/app.mjs', 'source-read');
  deny('jq -f .project/notes/a.jq .project/evidence/T1.json', 'source-read');
  deny('"$LOOM_BIN" status | jq --rawfile x src/app.mjs "."', 'source-read');
  deny('"$LOOM_BIN" status | jq -rf .project/notes/a.jq', 'source-read');
  deny('"$LOOM_BIN" status | grep -r foo', 'source-search');
  deny('"$LOOM_BIN" status | grep -Ef src/app.mjs', 'source-search');
  deny('"$LOOM_BIN" status | sort -o src/out.txt', 'source-read');
  deny('"$LOOM_BIN" status | sort -ro src/out.txt', 'source-read');
  deny('git -C /tmp show abc123:a.txt | head -n 10', 'source-read');
  deny('cat .project/../src/app.mjs', 'source-read');
  deny('cat .project/../*.mjs', 'source-read');
  deny('cat /private/tmp/scratchpad/diff.txt', 'source-read');
  deny('tail -n +1 src/app.mjs', 'source-read');
  deny('node -e "console.log(1)"', 'unclassified-tool');
  deny('for f in .project/evidence/*; do cat "$f"; done', 'unclassified-tool');
});

test('tool guard denials return one concise "禁止：<原因>；改为：<允许的替代>" line without leaking command text', t => {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-senior-msg-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.project/loomd/sessions'), { recursive: true });
  const log = join(project, '.project/loomd/sessions/a.tool-guard.jsonl');
  const cases = [
    ['Bash', { command: 'npm test -- secret-flag' }],
    ['Bash', { command: 'git merge candidate-branch' }],
    ['Bash', { command: 'while true; do "$LOOM_BIN" state leader; done' }],
    ['Bash', { command: 'git grep secret-token HEAD' }],
    ['Bash', { command: 'cat secret-file.mjs' }],
    ['Bash', { command: 'node -e "secret"' }],
    ['Read', { file_path: 'secret-file.mjs', limit: 300 }],
    ['Grep', { pattern: 'secret', path: 'src' }],
  ];
  for (const [name, input] of cases) {
    const receipt = recordSeniorToolDenial(log, project, project, name, input);
    assert.ok(receipt, `expected denial for ${name}`);
    assert.equal(receipt.includes('\n'), false, `denial must be single line: ${receipt}`);
    assert.match(receipt, /^禁止：.+；改为：.+$/);
    assert.equal(receipt.includes('secret-'), false, `must not leak command/path: ${receipt}`);
  }
});

test('override target parser enforces a unique project file and line range <= 200', t => {
  const project = mkdtempSync(join(realpathSync(tmpdir()), 'loom-override-target-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, 'src'), { recursive: true });
  writeFileSync(join(project, 'src/ok.mjs'), '1\n2\n');

  assert.deepEqual(parseOverrideLines('1-200'), { ok: true, start: 1, end: 200, count: 200, range: '1-200' });
  assert.deepEqual(parseOverrideLines('69-103'), { ok: true, start: 69, end: 103, count: 35, range: '69-103' });
  assert.deepEqual(parseOverrideLines('42-42'), { ok: true, start: 42, end: 42, count: 1, range: '42-42' });
  assert.equal(parseOverrideLines('1-201').code, 'senior-override-range-exceeded');
  assert.equal(parseOverrideLines('100-350').code, 'senior-override-range-exceeded');
  assert.equal(parseOverrideLines('0-10').ok, false);
  assert.equal(parseOverrideLines('20-10').ok, false);
  assert.equal(parseOverrideLines('all').ok, false);
  assert.equal(parseOverrideLines('').ok, false);

  const valid = parseOverrideFile(project, project, 'src/ok.mjs');
  assert.equal(valid.ok, true);
  assert.equal(valid.relative, 'src/ok.mjs');
  const futureShaFile = parseOverrideFile(project, project, 'src/only-on-candidate.mjs');
  assert.equal(futureShaFile.ok, true);
  assert.equal(futureShaFile.relative, 'src/only-on-candidate.mjs');
  assert.equal(parseOverrideFile(project, project, '').ok, false);
  assert.equal(parseOverrideFile(project, project, 'src').ok, false);
  assert.equal(parseOverrideFile(project, project, 'src/*.mjs').ok, false);
  assert.equal(parseOverrideFile(project, project, 'src/a.mjs,src/b.mjs').ok, false);
  assert.equal(parseOverrideFile(project, project, '../outside.mjs').ok, false);
  assert.equal(parseOverrideFile(project, project, '/private/tmp/diff.txt').ok, false);
  assert.equal(parseOverrideFile(project, project, '.env').ok, false);
});
