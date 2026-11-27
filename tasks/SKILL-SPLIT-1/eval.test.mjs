import assert from 'node:assert/strict';
import { execFile, mkdtemp } from '../../fixtures/test-process.mjs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { describeSkill, execWithoutStdin, loadBaseline, parseNative, summarize } from './eval.mjs';
import { roles, scenarios, sha } from './scenarios.mjs';
import { createFixture, fixturePrompt, score } from './simulator.mjs';

const skill = await loadBaseline();
const audit = await readFile(new URL('./AUDIT.md', import.meta.url), 'utf8');
const get = id => scenarios.find(scenario => scenario.id === id);
const read = input => ({ op: 'read', input });
const write = (input, content) => ({ op: 'write', input, content });
const loom = input => ({ op: 'loom', input });
const work = input => ({ op: 'work', input });
const finish = input => ({ op: 'finish', input });

test('the Codex launcher gives the native process a null input device and a literal prompt', async () => {
  const prompt = 'two lines\n"quotes" and $LOOM_EVAL_TEST';
  const script = `import { fstatSync, readFileSync, statSync } from 'node:fs';
const stdin = fstatSync(0);
const nullDevice = stdin.isCharacterDevice() && stdin.rdev === statSync('/dev/null').rdev;
console.log(JSON.stringify({ nullDevice, input: readFileSync(0, 'utf8'), prompt: process.argv[1] }));`;
  const { stdout } = await execWithoutStdin(process.execPath, ['--input-type=module', '-e', script, prompt], { timeout: 5_000 });
  assert.deepEqual(JSON.parse(stdout), { nullDevice: true, input: '', prompt });
});

test('the pinned audit accounts for every source line and all action lines map to rules', () => {
  const size = describeSkill(skill);
  assert.deepEqual(size, { blob: '2bd9b8357fe6cdad12a805e4eba15083c32309de', bytes: 13421, lines: 91, estimatedTokens: 4767 });
  assert.deepEqual([...audit.matchAll(/^\| (\d+) \|/gm)].map(match => Number(match[1])),
    Array.from({ length: size.lines }, (_, index) => index + 1));
  const ruleIds = scenarios.flatMap(scenario => scenario.rules.map(rule => rule.id));
  assert.equal(new Set(ruleIds).size, ruleIds.length);
  assert.equal(new Set(scenarios.map(scenario => scenario.id)).size, scenarios.length);
  const lines = new Set(scenarios.flatMap(scenario => scenario.rules.flatMap(rule => rule.lines)));
  for (const [i, line] of skill.split('\n').entries()) {
    if (!line.trim() || /^(?:#|---|name:|description:)|^`{3}/.test(line.trim())) continue;
    assert.ok(lines.has(i + 1), `Skill line ${i + 1} lacks a scenario`);
  }
  for (const role of roles) assert.ok(scenarios.filter(scenario => scenario.role === role).length >= 3);
});

const profile = mode => ({ cli: 'codex', model: 'gpt-6.2-sol', effort: 'high', mode });
const decision = '.project/decisions/B7.md';
const receipts = [
  ['S01-policy', [
    read('../../examples/policy.json'),
    loom('loom daemon status --project /eval/project'),
    loom('loom daemon start --project /eval/project'),
    write('.project/policy.json', JSON.stringify({ deny: [{ model: 'luna' }], roles: {
      auditor: { preferred: [profile('tui')] },
      leader: { preferred: [profile('tui')], deny: [{ model: 'gpt-5.4' }], maxActiveWorkers: 3 },
      worker: { preferred: [profile('headless')] },
    } })),
    loom('loom spawn auditor --project /eval/project --cwd /eval/project 接管脱敏导出'),
    finish('已启动 Auditor。'),
  ]],
  ['A02-gate', [
    loom('loom send super 保持授权边界'), read('.project/gates/G7-r2.json'),
    loom('loom send w7 请回传集成证据'), read('evidence/G7.json'),
    loom('loom send leader --mode interrupt G7 阻断须修复'),
    loom('loom notifications --needs-decision G7重复阻断，见evidence/G7.json --audit-escalation blocking-disagreement'),
    finish('REJECT\n\n证据显示全量验收失败。'),
  ]],
  ['L03-decision', [
    write(decision, 'T8 授权边界外。A 保持现状。B 扩大授权。推荐 A。'),
    loom(`"/eval/bin/loom" notifications --needs-decision "T8 等授权，见 ${decision}" --kind decision`),
    loom('loom send w7 receipts/R7.md 请核对原件'),
    finish('BLOCKED T8 授权'),
  ]],
  ['W02-integration', [
    loom('"$LOOM_BIN" hist lead --evidence'), work(`git checkout --detach ${sha}`),
    work('ps -p 700,701'), work('TMPDIR=/eval/tmp/INT7 /eval/bin/test-all'),
    write('artifacts/INT7.txt', `${sha} /eval/bin/test-all exit 0 97 passed`),
    finish('DONE INT7\n验收见 artifacts/INT7.txt\nLeftovers & deviations: none'),
  ]],
];

function observed(scenario, actions) {
  const fixture = createFixture(scenario);
  for (const action of actions.slice(0, -1)) fixture.operate(action);
  return [...fixture.trace, actions.at(-1)];
}

test('the scorer accepts reference executions and rejects missing steps and prose-only mentions', () => {
  for (const [id, actions] of receipts) {
    const scenario = get(id);
    const trace = observed(scenario, actions);
    assert.equal(score(scenario, trace).passed, true, id);
    for (const index of trace.keys()) {
      const without = trace.filter((_, i) => i !== index);
      assert.equal(score(scenario, without).passed, false, `${id} missing action ${index}`);
    }
    assert.equal(score(scenario, [finish(JSON.stringify(actions))]).passed, false, id);
  }
});

test('commands, order, flags, content and forbidden attempts affect the corresponding rule', () => {
  const [id, actions] = receipts.at(-1);
  const scenario = get(id);
  const trace = observed(scenario, actions);
  assert.equal(score(scenario, [trace[0], trace[2], trace[1], ...trace.slice(3)]).passed, false);
  const relative = [loom('loom hist lead --evidence'), ...trace.slice(1)];
  assert.equal(score(scenario, relative).rules.find(rule => rule.id === 'W02b').passed, false);
  const wrong = [...trace.slice(0, 3), work('/eval/bin/test-all'), ...trace.slice(4)];
  assert.equal(score(scenario, wrong).rules.find(rule => rule.id === 'W02a').missingStep, 4);
  const fixture = createFixture(scenario);
  assert.match(fixture.operate(write('/protected/sentinel', 'no')), /not permitted/);
  assert.equal(score(scenario, [fixture.trace[0], ...trace]).passed, false);
  assert.equal(score(scenario, [...trace.slice(0, -1), finish('DONE INT7\ntext')]).passed, false);
  const [superId, superActions] = receipts[0];
  const authored = [read('/eval/project/examples/policy.json'), ...superActions.slice(1).map(action =>
    action.op === 'loom' ? loom(action.input.replace(/^loom /, '/eval/bin/loom ')) : action)];
  assert.equal(score(get(superId), observed(get(superId), authored)).passed, true);
  const reviewer = loom('/eval/bin/loom spawn reviewer --cwd /eval/review');
  assert.deepEqual(score(get('A03-reviewer'), [reviewer, reviewer, finish('PASS')]).constraints, [false]);
  const notify = ' notifications --project /eval/project --complete 已归档 --phase P3';
  assert.deepEqual(score(get('S04-close'), [loom('loom' + notify), loom('/eval/bin/loom' + notify),
    finish('已结束')]).constraints, [true]);
});

test('distinct read, red-line, module and native usage denominators exclude blocked runs', () => {
  const runs = receipts.map(([id, trace], i) => {
    const scenario = get(id);
    return { status: 'scored', moduleInjected: i === 2, usage: { input: 100 + i },
      score: score(scenario, observed(scenario, trace)) };
  });
  runs.push({ status: 'authentication-required' });
  assert.deepEqual(summarize(runs), {
    attempted: 5, statuses: { scored: 4, 'authentication-required': 1 }, passed: [4, 4],
    redlineViolations: [0, 4], requiredReadsMissed: [0, 1], injectedModulePasses: [1, 1],
    inlineModuleEquivalentPasses: [1, 1], nativeInputTokens: { n: 4, mean: 101.5, min: 100, max: 103 },
  });
  const [id, trace] = receipts[0];
  const run = { status: 'scored', score: score(get(id), observed(get(id), trace.slice(1))) };
  assert.deepEqual(summarize([run]).requiredReadsMissed, [1, 1]);
  assert.deepEqual(summarize([]).nativeInputTokens, { n: 0, mean: null, min: null, max: null });
});

test('baseline prompt contains the exact skill and does not disclose the verifier', () => {
  const scenario = get('L03-decision');
  const baseline = fixturePrompt(scenario, skill);
  assert.ok(baseline.includes(skill));
  assert.ok(!baseline.includes('L03a') && !baseline.includes('随事件投递的说明'));
  assert.ok(fixturePrompt(scenario, 'core', 'delivery module').endsWith('delivery module\n'));
});

test('provider parsers identify real completion and separate cached input', () => {
  const jsonl = values => values.map(value => JSON.stringify(value)).join('\n');
  assert.deepEqual(parseNative('codex', jsonl([
    { type: 'item.completed', item: { type: 'agent_message', text: 'DONE' } },
    { type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 80, output_tokens: 15 } },
  ])), { ok: true, final: 'DONE', usage: { input: 100, cached: 80, output: 15 } });
  assert.deepEqual(parseNative('claude', jsonl([
    { type: 'result', subtype: 'success', result: 'DONE', modelUsage: { sonnet: {} },
      usage: { input_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 1, output_tokens: 15 } },
  ])), { ok: true, final: 'DONE', observedModel: 'sonnet', usage: { input: 101, cached: 80, cacheWritten: 1, output: 15 } });
  assert.deepEqual(parseNative('gemini', jsonl([
    { type: 'init', model: 'gemini-test' }, { type: 'message', role: 'assistant', content: 'working' },
    { type: 'tool_result' }, { type: 'message', role: 'assistant', content: 'DONE' },
    { type: 'result', status: 'success', stats: { input_tokens: 100, cached: 80, output_tokens: 15 } },
  ])), { ok: true, final: 'DONE', observedModel: 'gemini-test', usage: { input: 100, cached: 80, output: 15 } });
  assert.deepEqual(parseNative('agy', jsonl([
    { event: 'init', init: { model: 'Gemini 4 Neon (Low)' } },
    { event: 'result', result: { status: 'SUCCESS', response: 'DONE',
      usage: { input_tokens: 100, cache_read_tokens: 80, output_tokens: 15, thinking_tokens: 5 } } },
  ])), { ok: true, final: 'DONE', observedModel: 'Gemini 4 Neon (Low)',
    usage: { input: 100, cached: 80, output: 15, thinking: 5 } });
  for (const vendor of ['codex', 'claude', 'agy', 'gemini']) assert.equal(Boolean(parseNative(vendor, '{}').ok), false);
});

test('stdio MCP session records real fixture actions and returns ordered RED and GREEN receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'loom-fixture-test-'));
  const log = join(root, 'trace.jsonl');
  const script = fileURLToPath(new URL('./simulator.mjs', import.meta.url));
  const child = execFile(process.execPath, [script, '--serve', 'W01-fix', log]);
  const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  let id = 0;
  async function call(method, params) {
    child.stdin.write(JSON.stringify({ id: ++id, jsonrpc: '2.0', method, params }) + '\n');
    const { value } = await output.next();
    return JSON.parse(value).result;
  }
  try {
    assert.equal((await call('initialize', { protocolVersion: '2024-11-05' })).protocolVersion, '2024-11-05');
    assert.equal((await call('tools/list')).tools[0].name, 'operate');
    const params = { name: 'operate', arguments: work('npm test -- parser.test.js') };
    const send = arguments_ => call('tools/call', { name: 'operate', arguments: arguments_ });
    await send(write('tests/parser.test.js', 'parse([1]) and parse([]) both checked'));
    assert.match((await call('tools/call', params)).content[0].text, /^RED exit 1/);
    await send(write('src/parser.js', 'if (!input.length) return []'));
    assert.match((await call('tools/call', params)).content[0].text, /^GREEN exit 0/);
    assert.equal((await readFile(log, 'utf8')).trimEnd().split('\n').length, 4);
  } finally {
    child.stdin.end();
    await rm(root, { recursive: true, force: true });
  }
});
