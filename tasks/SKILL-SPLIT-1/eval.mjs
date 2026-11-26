import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { estimateTokens } from '../../lib/token-budget.mjs';
import { assembleRoleCore, stripSkillComments } from '../../lib/role-skill.mjs';
import { roles, scenarios } from './scenarios.mjs';
import { fixturePrompt, score } from './simulator.mjs';

const exec = promisify(execFile);
const location = dirname(fileURLToPath(import.meta.url));
const skillPath = join(location, '../../skills/loom/SKILL.md');
const simulatorPath = join(location, 'simulator.mjs');
const baselineBlob = '2bd9b8357fe6cdad12a805e4eba15083c32309de';
const vendors = ['codex', 'claude', 'agy', 'gemini'];
const quote = JSON.stringify;
const repo = resolve(location, '../..');

export function describeSkill(skill) {
  const bytes = Buffer.byteLength(skill);
  const blob = createHash('sha1').update(`blob ${bytes}\0`).update(skill).digest('hex');
  return { blob, bytes, lines: skill.trimEnd().split('\n').length, estimatedTokens: estimateTokens(skill) };
}

export async function loadBaseline() {
  const skill = await readFile(skillPath, 'utf8').catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return '';
  });
  if (describeSkill(skill).blob === baselineBlob) return skill;
  const { stdout } = await exec('/usr/bin/git', ['cat-file', 'blob', baselineBlob], { cwd: repo });
  if (describeSkill(stdout).blob !== baselineBlob) throw new Error('Pinned baseline SKILL.md is unavailable');
  return stdout;
}

export function summarize(runs) {
  const finished = runs.filter(run => run.status === 'scored');
  const rules = finished.flatMap(run => run.score.rules);
  const redlines = rules.filter(rule => rule.metric === 'redline');
  const reads = rules.filter(rule => rule.metric === 'read');
  const modules = finished.filter(run => run.moduleInjected).flatMap(run => run.score.rules)
    .filter(rule => rule.metric === 'module');
  const deliveredInline = finished.filter(run => !run.moduleInjected).flatMap(run => run.score.rules)
    .filter(rule => rule.metric === 'module');
  const input = finished.map(run => run.usage?.input).filter(Number.isFinite);
  return {
    attempted: runs.length,
    statuses: Object.fromEntries(Object.entries(Object.groupBy(runs, run => run.status))
      .map(([key, values]) => [key, values.length])),
    passed: [finished.filter(run => run.score.passed).length, finished.length],
    redlineViolations: [redlines.filter(rule => !rule.passed).length, redlines.length],
    requiredReadsMissed: [reads.reduce((sum, rule) => sum + rule.unread, 0),
      reads.reduce((sum, rule) => sum + rule.readOpportunities, 0)],
    injectedModulePasses: [modules.filter(rule => rule.passed).length, modules.length],
    inlineModuleEquivalentPasses: [deliveredInline.filter(rule => rule.passed).length, deliveredInline.length],
    nativeInputTokens: { n: input.length, mean: input.length ? input.reduce((a, b) => a + b) / input.length : null,
      min: input.length ? Math.min(...input) : null, max: input.length ? Math.max(...input) : null },
  };
}

function events(text) {
  return text.split('\n').filter(line => line.trim().startsWith('{')).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export function parseNative(vendor, stdout) {
  const rows = events(stdout);
  if (vendor === 'agy') {
    const result = rows.findLast(row => row.event === 'result')?.result;
    const usage = result?.usage;
    return { ok: result?.status === 'SUCCESS', final: result?.response,
      observedModel: result?.model ?? rows.find(row => row.event === 'init')?.init?.model ?? null,
      usage: usage ? { input: usage.input_tokens, cached: usage.cache_read_tokens,
        output: usage.output_tokens, thinking: usage.thinking_tokens } : null };
  }
  if (vendor === 'codex') {
    const turn = rows.findLast(row => row.type === 'turn.completed');
    const usage = turn?.usage;
    const final = rows.findLast(row => row.type === 'item.completed' && row.item?.type === 'agent_message')?.item.text;
    return { ok: Boolean(turn), final, usage: usage ? {
      input: usage.input_tokens, cached: usage.cached_input_tokens, output: usage.output_tokens,
    } : null };
  }
  const result = rows.findLast(row => row.type === 'result');
  if (vendor === 'claude') {
    const usage = result?.usage;
    return { ok: result?.subtype === 'success' && !result.is_error, final: result?.result,
      observedModel: Object.keys(result?.modelUsage ?? {}).join(', ') || null,
      usage: usage ? {
        input: usage.input_tokens + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
        cached: usage.cache_read_input_tokens, cacheWritten: usage.cache_creation_input_tokens, output: usage.output_tokens,
      } : null };
  }
  const messages = rows.filter(row => row.type === 'message' && row.role === 'assistant');
  const lastTool = rows.findLastIndex(row => row.type === 'tool_result');
  const usage = result?.stats;
  return { ok: result?.status === 'success',
    final: messages.filter(row => rows.indexOf(row) > lastTool).map(row => row.content).join(''),
    observedModel: rows.find(row => row.type === 'init')?.model, usage: usage ? {
      input: usage.input_tokens, cached: usage.cached, output: usage.output_tokens,
    } : null };
}

async function cliOptions(vendor, model, prompt, root, toolArgs) {
  const mcp = { command: process.execPath, args: toolArgs };
  if (vendor === 'codex') return [
    'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '--color', 'never', '--json', '--model', model,
    '--disable', 'shell_tool', '--disable', 'hooks', '-c', 'features.memories=false',
    '-c', 'model_reasoning_effort="low"',
    '-c', 'approval_policy="never"', '-c', 'web_search="disabled"',
    '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false',
    '-c', `mcp_servers.evaluate.command=${quote(mcp.command)}`,
    '-c', `mcp_servers.evaluate.args=${quote(mcp.args)}`, '-c', 'mcp_servers.evaluate.required=true',
    '-c', 'mcp_servers.evaluate.tools.operate.approval_mode="approve"',
    '-c', 'mcp_servers.evaluate.startup_timeout_sec=5', prompt,
  ];
  if (vendor === 'claude') return [
    '--print', '--output-format', 'json', '--model', model, '--effort', 'low', '--no-session-persistence',
    '--setting-sources', '', '--disable-slash-commands', '--no-chrome',
    '--tools', '', '--permission-mode', 'dontAsk', '--allowed-tools', 'mcp__evaluate__operate',
    '--strict-mcp-config', '--mcp-config', quote({ mcpServers: { evaluate: mcp } }), '--', prompt,
  ];
  if (vendor === 'agy') {
    const work = join(root, 'work');
    const config = join(work, '.agents');
    await mkdir(config);
    await writeFile(join(config, 'mcp_config.json'), quote({ mcpServers: { evaluate: { ...mcp, enabledTools: ['operate'] } } }));
    const hook = join(root, 'fixture-only.mjs');
    await writeFile(hook, `import { readFileSync } from 'node:fs';
const event = JSON.parse(readFileSync(0, 'utf8'));
const name = (event.toolCall ?? event.tool_call)?.name;
if (!/^(?:mcp_+)?evaluate_+operate$/.test(name ?? '')) {
  console.log(JSON.stringify({ decision: 'deny', reason: 'Only the evaluation fixture tool is available.' }));
}
`);
    await writeFile(join(config, 'hooks.json'), quote({ 'loom-eval': {
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `${process.execPath} ${hook}`, timeout: 5 }] }],
    } }));
    return ['--model', model, '--output-format', 'stream-json', '--disable-slash-commands',
      '--log-file', join(root, 'agy.log'), '--settings', quote({ trustedWorkspaces: [work], notifications: false }),
      '--print', prompt];
  }
  await writeFile(join(root, 'gemini-settings.json'), quote({
    general: { enableAutoUpdate: false, enableUpdateNag: false, checkpointing: { enabled: false } },
    tools: { core: [] }, mcp: { allowed: ['evaluate'] }, telemetry: { enabled: false },
    advanced: { ignoreLocalEnv: true }, mcpServers: { evaluate: { ...mcp, trust: true } },
  }));
  return ['--model', model, '--output-format', 'stream-json', '--allowed-mcp-server-names', 'evaluate',
    '--prompt', prompt];
}

async function privateRun(binary, vendor, loggedIn, call) {
  const root = await mkdtemp('/private/tmp/loom-skill-eval-');
  try {
    const paths = Object.fromEntries(['home', 'work', 'tmp', 'data'].map(name => [name, join(root, name)]));
    await Promise.all(Object.values(paths).map(path => mkdir(path, { mode: 0o700 })));
    const env = {
      HOME: paths.home, TMPDIR: paths.tmp, PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`,
      XDG_CONFIG_HOME: paths.data, XDG_DATA_HOME: paths.data, XDG_STATE_HOME: paths.data,
      XDG_CACHE_HOME: paths.data, CODEX_HOME: paths.data, CLAUDE_CONFIG_DIR: paths.data,
      GEMINI_CLI_HOME: paths.home, GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(root, 'gemini-settings.json'),
      GEMINI_CLI_SYSTEM_DEFAULTS_PATH: '/dev/null',
      LANG: 'en_US.UTF-8', TERM: 'dumb', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: '0', CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
      AGY_CLI_DISABLE_AUTO_UPDATE: 'true',
      CLAUDE_CODE_TMPDIR: paths.tmp,
    };
    const home = homedir();
    if (loggedIn) {
      env.HOME = home;
      delete env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
      for (const name of ['USER', 'LOGNAME', 'SHELL', 'SECURITYSESSIONID', 'LaunchInstanceID',
        'XPC_SERVICE_NAME', '__CFBundleIdentifier', '__CF_USER_TEXT_ENCODING', 'COMMAND_MODE',
        'TERM_PROGRAM', 'COLORTERM', 'LC_ALL', 'LC_CTYPE', 'HOMEBREW_PREFIX', 'HOMEBREW_CELLAR', 'HOMEBREW_REPOSITORY']) {
        if (process.env[name]) env[name] = process.env[name];
      }
      for (const name of ['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'GEMINI_CLI_HOME', 'XDG_CONFIG_HOME',
        'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'ANTIGRAVITY_APP_DATA_DIR', 'GEMINI_HOME']) {
        delete env[name];
        if (process.env[name]) env[name] = process.env[name];
      }
    }
    const agyData = join(home, '.gemini/antigravity-cli');
    const denyMemory = [join(home, '.codex/memories'), join(home, '.claude/projects'),
      join(home, '.gemini/config/hooks.json'), join(home, '.gemini/config/mcp_config.json'),
      join(agyData, 'plugins'), join(home, '.agents'), join(home, 'Code')];
    const profile = loggedIn ? `(version 1)
(allow default)
(deny file-read* ${denyMemory.map(path => `(subpath ${quote(path)})`).join(' ')})
${vendor === 'codex' ? `(deny file-write* (literal ${quote(join(env.CODEX_HOME ?? join(home, '.codex'), 'config.toml'))})
  (subpath ${quote(join(home, 'Code'))}) (subpath ${quote(join(home, '.codex/memories'))}))` : '(deny file-write*)'}
(allow file-write* (subpath ${quote(root)}) (literal "/dev/null")
${vendor === 'agy' ? ['brain', 'conversations', 'log'].map(name => `(subpath ${quote(join(agyData, name))})`).join(' ') +
  `(literal ${quote(join(agyData, 'bin/agentapi'))})` : ''})
` : `(version 1)
(allow default)
(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.securityd.xpc")
    (global-name "com.apple.security.agent") (global-name "com.apple.SecurityServer"))
(deny file-read* (subpath "/Users") (subpath "/Library/Keychains") (subpath "/System/Library/Keychains")
    (subpath "/Library/Application Support/ClaudeCode") (subpath "/Library/Application Support/GeminiCli"))
(allow file-read* (literal ${quote(binary)}) (subpath ${quote(root)}))
(deny file-write*)
(allow file-write* (subpath ${quote(root)}) (literal "/dev/null"))`;
    return await call(root, args => {
      const process = exec('/usr/bin/sandbox-exec', ['-p', profile, binary, ...args],
        { cwd: paths.work, env, timeout: 150_000, killSignal: 'SIGKILL', maxBuffer: 2 ** 22, encoding: 'utf8' });
      process.child.stdin.end();
      return process;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function blocked(error) {
  const text = [error.stdout, error.stderr].join('\n');
  if (/not logged in|please run .?\/login|authentication required|not authenticated|missing (?:api key|bearer)|set an auth method|\b401\s+Unauthorized/i.test(text)) return 'authentication-required';
  if (/^sandbox-exec: .* (?:denied|permitted)/mi.test(text)) return 'launch-denied';
  if (/required MCP servers failed to initialize/i.test(text)) return 'fixture-unavailable';
  if (/error sending request|error trying to connect|stream disconnected|failed to connect|could not resolve host/i.test(text)) {
    return 'provider-unreachable';
  }
  if (error.killed) return 'timeout';
  return 'native-error';
}

async function modelRun(vendor, binary, model, scenario, skill, files, module, loggedIn) {
  return privateRun(binary, vendor, loggedIn, async (root, launch) => {
    const log = join(root, 'trace.jsonl');
    const extra = join(root, 'references.json');
    const sandboxSim = join(root, 'tasks/SKILL-SPLIT-1');
    const sandboxLib = join(root, 'lib');
    await Promise.all([sandboxSim, sandboxLib].map(path => mkdir(path, { recursive: true, mode: 0o700 })));
    await Promise.all([
      copyFile(simulatorPath, join(sandboxSim, 'simulator.mjs')),
      copyFile(join(location, 'scenarios.mjs'), join(sandboxSim, 'scenarios.mjs')),
      copyFile(join(repo, 'lib/token-budget.mjs'), join(sandboxLib, 'token-budget.mjs')),
      writeFile(extra, quote(files)),
    ]);
    const args = await cliOptions(vendor, model, fixturePrompt(scenario, skill, module),
      root, [join(sandboxSim, 'simulator.mjs'), '--serve', scenario.id, log, extra]);
    const started = performance.now();
    let result;
    try {
      result = await launch(args);
    } catch (error) {
      const tls = String(error.stdout).includes('invalid peer certificate: UnknownIssuer');
      return { status: blocked(error), ...(tls && { detail: 'tls-unknown-issuer' }),
        exitCode: typeof error.code === 'number' ? error.code : null,
        wallMs: Math.round(performance.now() - started) };
    }
    const native = parseNative(vendor, result.stdout);
    const wallMs = Math.round(performance.now() - started);
    if (!native.ok || typeof native.final !== 'string') return { status: blocked(result), wallMs };
    const trace = events(await readFile(log, 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    }));
    trace.push({ op: 'finish', input: native.final.trim() });
    return { status: 'scored', wallMs, observedModel: native.observedModel ?? null, finalReply: native.final,
      usage: native.usage, toolCalls: trace.length - 1, score: score(scenario, trace) };
  });
}

async function loadArm(plan) {
  if (!plan) {
    const skill = await loadBaseline();
    return { id: 'baseline', skills: Object.fromEntries(roles.map(role => [role, skill])), files: {}, modules: {} };
  }
  const config = JSON.parse(await readFile(plan, 'utf8'));
  const load = async paths => Object.fromEntries(await Promise.all(Object.entries(paths ?? {}).map(async ([key, path]) =>
    [key, await readFile(resolve(dirname(plan), path), 'utf8')])));
  const [skills, files, modules] = await Promise.all([load(config.skills), load(config.references), load(config.modules)]);
  for (const name of Object.keys(modules)) modules[name] = stripSkillComments(modules[name]);
  if (typeof config.id !== 'string' || config.id === 'baseline' || !roles.every(role => skills[role]?.trim())) {
    throw new Error('An alternate arm needs a unique ID and all four role cores');
  }
  if (config.common) {
    const common = await readFile(resolve(dirname(plan), config.common), 'utf8');
    for (const role of roles) skills[role] = assembleRoleCore(common, skills[role]);
  }
  return { id: config.id, skills, files, modules };
}

async function main() {
  const { values: flags } = parseArgs({ options: {
    arm: { type: 'string' }, cli: { type: 'string' }, binary: { type: 'string' }, model: { type: 'string' },
    runs: { type: 'string', default: '2' }, case: { type: 'string', multiple: true }, out: { type: 'string' },
    describe: { type: 'boolean' }, 'logged-in': { type: 'boolean' }, jobs: { type: 'string', default: '1' },
  } });
  const arm = await loadArm(flags.arm);
  const sizes = Object.fromEntries(roles.map(role => [role, describeSkill(arm.skills[role])]));
  if (flags.describe) return console.log(JSON.stringify({ arm: arm.id, sizes, scenarios: scenarios.map(({ id, role }) => ({ id, role })) }, null, 2));
  if (!vendors.includes(flags.cli) || !flags.model || !isAbsolute(flags.binary ?? '') || !flags.out) {
    throw new Error('Provide --cli codex|claude|agy|gemini --binary /absolute/path --model ID --out FILE [--runs N] [--case ID]');
  }
  if (process.platform !== 'darwin') throw new Error('Native launch requires the macOS process sandbox');
  const repeats = Number(flags.runs);
  const jobs = Number(flags.jobs);
  const selected = scenarios.filter(scenario => !flags.case || flags.case.includes(scenario.id));
  if (!selected.length || flags.case?.some(id => !selected.some(scenario => scenario.id === id)) ||
      !Number.isSafeInteger(repeats) || repeats < 1 || !Number.isSafeInteger(jobs) || jobs < 1 || jobs > 6) {
    throw new Error('Invalid case, repeat count, or concurrency');
  }
  const binary = await realpath(flags.binary).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (binary && !/^\/(?:opt\/homebrew\/|usr\/local\/|Users\/[^/]+\/\.local\/(?:share\/claude\/versions\/|bin\/agy$))/.test(binary)) {
    throw new Error('Choose a native installation path outside project trees and wrappers');
  }
  const out = resolve(flags.out);
  const reporting = relative(repo, out);
  if (reporting.startsWith('../') || !reporting.startsWith('tasks/SKILL-SPLIT-1/')) {
    throw new Error('Write results under tasks/SKILL-SPLIT-1/');
  }
  let version = null;
  let startup;
  let isolatedLogin = null;
  if (binary) {
    await privateRun(binary, flags.cli, flags['logged-in'], async (_root, launch) => {
      try { version = (await launch(['--version'])).stdout.trim().slice(0, 120); }
      catch (error) { startup = blocked(error); }
      if (!startup && flags.cli === 'codex' && !flags['logged-in']) {
        try {
          await launch(['-c', 'cli_auth_credentials_store="file"', 'login', 'status']);
          isolatedLogin = 'reported-logged-in';
        } catch (error) {
          isolatedLogin = blocked(error) === 'authentication-required' ? 'not-logged-in' : 'unknown';
        }
      }
    });
  }
  if (!binary) startup = 'missing-binary';
  const runs = [];
  const report = () => writeFile(out, JSON.stringify({
    date: new Date().toISOString(), arm: arm.id, cli: flags.cli, binary: binary ?? flags.binary, version,
    modelRequested: flags.model, login: flags['logged-in'] ? 'native' : 'isolated', isolatedLogin, sizes, repeats,
    selected: selected.map(row => row.id),
    summary: summarize(runs), byRole: Object.fromEntries(roles.map(role => [role, summarize(runs.filter(row => row.role === role))])),
    runs,
  }, null, 2) + '\n');
  const queue = selected.flatMap(scenario => Array.from({ length: repeats }, (_, i) => ({ scenario, repeat: i + 1 })));
  let next = 0;
  let reports = Promise.resolve();
  let halted = false;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (!halted && next < queue.length) {
      const { scenario, repeat } = queue[next++];
      const module = arm.modules[scenario.module];
      const result = startup ? { status: startup } :
        await modelRun(flags.cli, binary, flags.model, scenario, arm.skills[scenario.role], arm.files, module, flags['logged-in']);
      runs.push({ case: scenario.id, role: scenario.role, repeat, moduleInjected: Boolean(module), ...result });
      if (['authentication-required', 'launch-denied', 'missing-binary', 'fixture-unavailable'].includes(result.status)) halted = true;
      await (reports = reports.then(report));
      console.log(`${scenario.id} #${repeat} ${result.status}${result.score ? (result.score.passed ? ' PASS' : ' FAIL') : ''}`);
    }
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
