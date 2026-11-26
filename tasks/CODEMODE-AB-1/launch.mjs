import { readFileSync } from 'node:fs';

const skill = readFileSync(new URL('./script-first.md', import.meta.url), 'utf8');
const claude = '/Users/sun/.local/share/claude/versions/2.1.331';
const codex = '/opt/homebrew/Caskroom/codex/0.172.0/bin/codex';

export const arms = ['C0', 'C1', 'C2', 'X0', 'X1', 'X2'];

export function profile(arm, cwd, logs) {
  if (!arms.includes(arm)) throw new RangeError('Expected an arm C0–C2 or X0–X2');
  if (arm.startsWith('C')) {
    const model = 'claude-sonnet-5-5';
    return {
      vendor: 'claude', binary: claude, version: '2.1.331', model,
      args: ['--model', model, '--setting-sources', '',
        ...(arm === 'C2' ? ['--append-system-prompt', skill] : [])],
      env: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        ...(arm !== 'C0' && { CLAUDE_CODE_EXPERIMENTAL_CODE_MODE: arm === 'C1' ? '1' : '0' }) },
    };
  }
  const model = 'gpt-6.2-sol';
  return {
    vendor: 'codex', binary: codex, version: '0.172.0', model,
    args: ['--model', model, '-c', 'features.memories=false',
      '-c', `log_dir=${JSON.stringify(logs)}`, '-c', `projects={${JSON.stringify(cwd)}={trust_level="trusted"}}`,
      ...(arm === 'X1' ? ['-c', `developer_instructions=${JSON.stringify(skill)}`] : []),
      ...(arm === 'X2' ? ['-c', 'features.code_mode.enabled=true'] : [])],
    env: {},
  };
}
