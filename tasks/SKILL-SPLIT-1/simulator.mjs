import { createInterface } from 'node:readline';
import { appendFileSync, readFileSync } from 'node:fs';
import { estimateTokens } from '../../lib/token-budget.mjs';
import { scenarios } from './scenarios.mjs';

const operations = ['read', 'write', 'loom', 'work', 'ask', 'poll', 'wait'];
const referenceAliases = {
  'references/policy.md': '../../examples/policy.json',
  'references/charter.md': '../../examples/charter.md',
  'references/rulings.md': '../../examples/rulings.md',
  'references/card.md': '../../examples/card.md',
  'references/runtime.md': 'docs/HEADLESS.md',
  '../../docs/HEADLESS.md': 'docs/HEADLESS.md',
};
export const tool = {
  name: 'operate',
  description: 'Act in the Loom fixture. Input is a virtual path, command, or question. Use content for writes. The tool does not access a real shell, filesystem, daemon, or user.',
  inputSchema: {
    type: 'object',
    properties: {
      op: { type: 'string', enum: operations }, input: { type: 'string' }, content: { type: 'string' },
    },
    required: ['op', 'input'], additionalProperties: false,
  },
};

function normalize(input) {
  return input.replace(/["']/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^LOOM_EXTERNAL_SUPER=1 (?=loom\b|\/eval\/bin\/loom\b|\$)/, '')
    .replace(/^\$(?:LOOM_BIN\b|\{LOOM_BIN\})/, '/eval/bin/loom')
    .replace(/\$(?:PROJECT\b|\{PROJECT\})/g, '/eval/project');
}

function normalizePath(input) {
  const path = input.replace(/^\$\{?LOOM_SKILL_ROOT\}?\//, '').replace(/^\/eval\/project\//, '').replace(/^\.\//, '')
    .replace(/^skills\/loom\//, '')
    .replace(/^(?:\.\.\/){0,2}examples\//, '../../examples/');
  return referenceAliases[path] ?? path;
}

export function matches(value, expected) {
  if (expected instanceof RegExp) return typeof value === 'string' && expected.test(value);
  if (Array.isArray(expected?.includes)) return typeof value === 'string' &&
    expected.includes.every(text => value.includes(text)) &&
    (expected.maxLines === undefined || value.trimEnd().split('\n').length <= expected.maxLines);
  if (expected?.policy) {
    let policy;
    try { policy = JSON.parse(value); } catch { return false; }
    const role = name => policy?.roles?.[name];
    return Array.isArray(policy?.deny) && policy.deny.some(entry => /(?:^|-)luna$/.test(entry?.model ?? '')) &&
      Array.isArray(role('leader')?.deny) && role('leader').deny.some(entry => entry?.model === 'gpt-5.4') &&
      role('leader')?.maxActiveWorkers === 3 && ['auditor', 'leader', 'worker'].every(name =>
        Array.isArray(role(name)?.preferred) && role(name).preferred.some(profile => profile?.cli === 'codex' &&
          profile.model === 'gpt-6.2-sol' && profile.effort === 'high' && profile.mode === (name === 'worker' ? 'headless' : 'tui')));
  }
  if (expected?.memory) {
    if (typeof value !== 'string' || estimateTokens(value) > 200) return false;
    const [, json, title, body] = /^---\n([^\n]+)\n---\n# ([^\n]+)\n\n([\s\S]+)$/.exec(value.trim()) ?? [];
    if (!body || /\d+\/\d+|(?:^|\s)\/(?:[^\s]+)/m.test(title + '\n' + body)) return false;
    let meta;
    try { meta = JSON.parse(json); } catch { return false; }
    return meta?.id === 'socket-path' && meta.scope === 'project' && /^[a-z0-9_-]+$/.test(meta.owner ?? '') &&
      meta.source === 'evidence/socket.md' && meta.verified === '2026-11-27' &&
      (meta.expires === undefined || /^\d{4}-\d{2}-\d{2}$/.test(meta.expires)) &&
      (meta.supersededBy === undefined || /^[a-z0-9_-]+$/.test(meta.supersededBy)) &&
      (meta.keywords === undefined || typeof meta.keywords === 'string') && body.includes('短路径');
  }
  return value === expected;
}

function matchAction(action, expected, role) {
  const inputs = action.op === 'loom' && role !== 'worker' ?
    [action.input, action.input.replace(/^\/eval\/bin\/loom(?= |$)/, 'loom'),
      action.input.replace(/^loom(?= |$)/, '/eval/bin/loom')] : [action.input];
  return action.op === expected.op &&
    (expected.input === undefined || inputs.some(input => matches(input, expected.input))) &&
    (expected.content === undefined || matches(action.content, expected.content));
}

export function score(scenario, trace) {
  const constraints = [
    ...(scenario.maxCalls ?? []).map(([pattern, cap]) =>
      trace.filter(action => matchAction(action, { op: 'loom', input: pattern }, scenario.role)).length <= cap),
    ...(scenario.sameInputs ?? []).map(pattern => {
      const values = trace.filter(action => matchAction(action, { op: 'loom', input: pattern }, scenario.role));
      return values.length > 1 && new Set(values.map(action => action.input.replace(/^\/eval\/bin\/loom\b/, 'loom'))).size === 1;
    }),
  ];
  const rules = scenario.rules.map(({ id, lines, steps, forbidden, metric = 'action' }) => {
    if (forbidden) {
      const violation = trace.findIndex(action => forbidden.some(expected => matchAction(action, expected, scenario.role)));
      return { id, lines, metric, passed: violation < 0, ...(violation >= 0 && { violation: violation + 1 }) };
    }
    let index = -1;
    const missing = steps.findIndex(expected => {
      index = trace.findIndex((action, i) => i > index && matchAction(action, expected, scenario.role));
      return index < 0;
    });
    return {
      id, lines, metric, passed: missing < 0, ...(missing >= 0 && { missingStep: missing + 1 }),
      ...(metric === 'read' && { unread: steps.filter(expected => !trace.some(action => matchAction(action, expected, scenario.role))).length,
        readOpportunities: steps.length }),
    };
  });
  const finished = trace.at(-1)?.op === 'finish' && trace.filter(action => action.op === 'finish').length === 1;
  return { passed: finished && constraints.every(Boolean) && rules.every(rule => rule.passed), finished, constraints, rules };
}

export function createFixture(scenario, extraFiles = {}) {
  const state = new Map();
  const responses = new Map();
  const trace = [];
  function operate({ op, input, content }) {
    if (!operations.includes(op) || typeof input !== 'string' || input.length > 4000 ||
        content !== undefined && (typeof content !== 'string' || content.length > 12000)) return 'Invalid fixture action';
    const value = ['read', 'write'].includes(op) ? normalizePath(input.trim()) : normalize(input);
    const action = { op, input: value, content };
    trace.push(action);
    if (op === 'read' && state.has(value)) return state.get(value);
    if (op === 'read' && Object.hasOwn(extraFiles, value)) return extraFiles[value];
    if (op === 'loom' && scenario.role === 'worker' && value === '/eval/bin/loom worker-check') {
      return 'Checkpoint verified. Branch: fixture. Base SHA: 1234567890abcdef1234567890abcdef12345678. WIP: +0/-0, 0 untracked. Rulings: follow this card.';
    }
    if (op === 'write') {
      if (!content) return 'No file content provided';
      if (/^(?:\/|protected\/)/.test(value) || value.split('/').includes('..')) return 'SANDBOX: operation not permitted';
      state.set(value, content);
      return 'Written in fixture';
    }
    const effect = [...(scenario.files ?? []), ...(scenario.effects ?? [])]
      .find(entry => matchAction(action, entry[0], scenario.role));
    if (effect) {
      const answer = effect[1];
      if (typeof answer === 'function') return answer(state);
      if (!Array.isArray(answer)) return answer;
      const times = responses.get(effect) ?? 0;
      responses.set(effect, times + 1);
      return answer[times] ?? 'No further result for this action';
    }
    if (op === 'ask' || op === 'poll' || op === 'wait') return 'No live user or background process in this fixture';
    if (op === 'loom' || op === 'work') return 'Recorded in fixture; no additional output';
    return 'File not present in fixture';
  }
  return { operate, trace };
}

export function fixturePrompt(scenario, skill, module) {
  return `# Loom role instructions\n\n${skill}\n\n# Fixture\n\n` +
    `你正在执行一个隔离的 Loom 模拟回合。角色为 ${scenario.role}。PROJECT=/eval/project，LOOM_BIN=/eval/bin/loom。\n` +
    '用 operate 工具实际执行操作。read 读制品路径，write 写路径和正文，loom 提交完整 Loom 命令，work 提交其它命令。' +
    '所有命令和路径都是虚拟的。工具会返回本轮可见的新证据。完成后直接给最终回复。\n' +
    `\n# 本轮投递\n\n${scenario.prompt}\n` +
    (module ? `\n# 随事件投递的说明\n\n${module}\n` : '');
}

function serve() {
  const [id, log, extraFile] = process.argv.slice(3);
  const scenario = scenarios.find(value => value.id === id);
  if (!scenario || !log) throw new Error('Expected an eval scenario ID and private log path');
  const extraFiles = extraFile ? JSON.parse(readFileSync(extraFile, 'utf8')) : {};
  const fixture = createFixture(scenario, extraFiles);
  const requests = createInterface({ input: process.stdin });
  forEachRequest(requests, request => {
    const { method, params } = request;
    if (method === 'initialize') return {
      protocolVersion: params.protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: 'loom-eval-fixture', version: '1.0.0' },
    };
    if (method === 'ping') return {};
    if (method === 'tools/list') return { tools: [tool] };
    if (method === 'tools/call' && params.name === tool.name) {
      const length = fixture.trace.length;
      const result = fixture.operate(params.arguments ?? {});
      if (fixture.trace.length > length) appendFileSync(log, JSON.stringify(fixture.trace.at(-1)) + '\n', { mode: 0o600 });
      return { content: [{ type: 'text', text: result }] };
    }
    return undefined;
  });
}

function forEachRequest(requests, respond) {
  requests.on('line', line => {
    let request;
    try { request = JSON.parse(line); } catch { return; }
    if (request.id === undefined) return;
    const result = respond(request);
    const reply = result === undefined ? { error: { code: -32601, message: 'Method not found' } } : { result };
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...reply }) + '\n');
  });
}

if (process.argv[2] === '--serve') serve();
