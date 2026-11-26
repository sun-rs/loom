import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const codexMemorySettings = [
  'features.memories', 'memories.generate_memories', 'memories.use_memories',
];
export const codexMemoryArgs = () => codexMemorySettings.flatMap(key => ['-c', key + '=false']);
export const memoryIsolationCoverage = provider =>
  ({ claude: 'covered', codex: 'covered', opencode: 'not needed' })[provider] ?? 'not covered';
export const claudeMemoryArgs = () => ['--system-prompt-snapshot', 'off'];

const quote = word => "'" + word.replaceAll("'", "'\\''") + "'";
const compactHook = fileURLToPath(new URL('./compact-hook.mjs', import.meta.url));
const claudeMemoryEnv = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_ENTRYPOINT: 'loom' };

export function memoryLaunch(provider, {
  indexText, compactIndexPath, claudeSettings = {}, openCodeConfig, openCodeNative = false,
} = {}) {
  const env = {};
  const argv = [];
  if (provider === 'claude') {
    Object.assign(env, claudeMemoryEnv);
    argv.push(...claudeMemoryArgs());
    if (indexText) argv.push('--append-system-prompt', indexText);
    if (compactIndexPath || indexText) {
      const command = [process.execPath, compactHook, ...(compactIndexPath ? ['file', compactIndexPath] : ['text', indexText])]
        .map(quote).join(' ');
      const hooks = claudeSettings.hooks ?? {};
      claudeSettings = { ...claudeSettings, hooks: { ...hooks, SessionStart: [...(hooks.SessionStart ?? []),
        { matcher: 'compact', hooks: [{ type: 'command', command }] }] } };
    }
  }
  if (provider === 'codex') argv.push(...codexMemoryArgs());
  if (provider === 'opencode') {
    env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = '1';
    if (indexText) {
      const config = JSON.parse(openCodeConfig ?? '{}');
      const group = openCodeNative ? 'agents' : 'agent';
      const field = openCodeNative ? 'system' : 'prompt';
      const agent = { ...config[group] };
      const prompts = [];
      for (const name of new Set(['build', 'plan', config.default_agent ?? 'build', ...Object.keys(agent)])) {
        if (agent[name]?.mode === 'subagent' || agent[name]?.disable || agent[name]?.hidden) continue;
        const prompt = [agent[name]?.[field], indexText].filter(Boolean).join('\n\n');
        prompts.push([JSON.stringify(prompt), JSON.stringify(prompt).replaceAll(/\{(?=env:|file:)/gu, '\\u007b')]);
        agent[name] = { ...agent[name], [field]: prompt };
      }
      env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ ...config, [group]: agent });
      for (const [literal, safe] of prompts) env.OPENCODE_CONFIG_CONTENT =
        env.OPENCODE_CONFIG_CONTENT.replaceAll(literal, () => safe);
    }
  }
  return { env, argv, claudeSettings };
}

export const codexDeveloperArgs = text => text ?
  ['-c', 'developer_instructions=' + JSON.stringify(text).replaceAll('\x7f', '\\u007f')] : [];

async function readIfPresent(read, path) {
  try {
    return await read?.(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  }
}

async function buildLaunch(mode, options, { readFile, readDir } = {}) {
  const { provider, cwd, home, binding } = options;
  const env = { ...options.env };
  const argv = [...(options.argv ?? [])];
  const threadConfig = { ...options.threadConfig };
  const warnings = [];
  const instructionFiles = [];
  const coverage = memoryIsolationCoverage(provider);
  const { indexText } = options;
  const settingsFlag = provider === 'claude' ? argv.findLastIndex(arg => arg === '--settings') : -1;
  const config = memoryLaunch(provider, { indexText, openCodeConfig: env.OPENCODE_CONFIG_CONTENT,
    claudeSettings: settingsFlag < 0 ? {} : JSON.parse(argv[settingsFlag + 1]) });
  Object.assign(env, config.env);
  const separator = argv.indexOf('--');
  const launchArgs = [...config.argv];
  if (provider === 'claude' && indexText) {
    if (settingsFlag < 0) launchArgs.push('--settings', JSON.stringify(config.claudeSettings));
    else argv[settingsFlag + 1] = JSON.stringify(config.claudeSettings);
  }
  if (provider === 'codex') {
    if (indexText) {
      threadConfig.developerInstructions = [threadConfig.developerInstructions, indexText].filter(Boolean).join('\n\n');
      launchArgs.push(...codexDeveloperArgs(threadConfig.developerInstructions));
    }
    for (const key of codexMemorySettings) {
      const [section, field] = key.split('.');
      if (mode !== 'tui' || Object.hasOwn(threadConfig, key)) threadConfig[key] = false;
      if (Object.hasOwn(threadConfig, section)) {
        threadConfig[section] = { ...threadConfig[section], [field]: false };
      }
    }
  }
  argv.splice(separator < 0 ? argv.length : separator, 0, ...launchArgs);
  if (provider === 'agy' && home) {
    const path = join(home, '.gemini', 'antigravity-cli', 'knowledge');
    if ((await readIfPresent(readDir, path))?.length) warnings.push({ path, recipient: 'super' });
  }

  const instruction = { claude: 'CLAUDE.md', codex: 'AGENTS.md', opencode: 'AGENTS.md' }[provider];
  if (instruction && cwd) {
    const path = join(cwd, instruction);
    if (await readIfPresent(readFile, path) != null) instructionFiles.push(path);
  }
  return { mode, provider, cwd, binding, argv, env, threadConfig, coverage, warnings, instructionFiles };
}

export const buildTuiLaunch = (options, io) => buildLaunch('tui', options, io);
export const buildOarLaunch = (options, io) => buildLaunch('oar', options, io);
export const buildResumeLaunch = (options, io) => buildLaunch('resume', options, io);
export const buildSwitchLaunch = (options, io) => buildLaunch('switch', options, io);
