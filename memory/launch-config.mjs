import { join } from 'node:path';

const codexMemorySettings = [
  'features.memories', 'memories.generate_memories', 'memories.use_memories',
];

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
  let coverage = 'not covered';

  if (provider === 'claude') {
    env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1';
    coverage = 'covered';
  }
  if (provider === 'codex') {
    const separator = argv.indexOf('--');
    argv.splice(separator < 0 ? argv.length : separator, 0,
      ...codexMemorySettings.flatMap(key => ['-c', key + '=false']));
    for (const key of codexMemorySettings) {
      const [section, field] = key.split('.');
      if (mode !== 'tui' || Object.hasOwn(threadConfig, key)) threadConfig[key] = false;
      if (Object.hasOwn(threadConfig, section)) {
        threadConfig[section] = { ...threadConfig[section], [field]: false };
      }
    }
    coverage = 'covered';
  }
  if (provider === 'opencode') {
    env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = '1';
    coverage = 'not needed';
  }
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
