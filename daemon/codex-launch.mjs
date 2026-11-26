import { join } from 'node:path';
import { allowNativeQuestions } from '../cli/policy.mjs';
import { codexEnvironmentArgs } from '../cli/project.mjs';
import { codexFastArgs } from './executables.mjs';
import { workerCodexArgs } from './worker-environment.mjs';

export function codexConfiguration(project, row, managed, isolated) {
  const toolsEnv = row.role === 'worker' ? { ...isolated, CODEX_HOME: join(isolated.HOME, '.codex') } : {};
  if (process.env.CODEX_HOME && /(?:provider-homes|(?:^|\/)memories|(?:^|\/)\.env)/.test(process.env.CODEX_HOME)) {
    throw new Error('Unsupported CODEX_HOME for loom');
  }
  return ['-c', 'features.memories=false', '-c',
    `features.default_mode_request_user_input=${allowNativeQuestions(project, row.role)}`, ...codexFastArgs(row.fast),
    ...(row.role === 'worker' ? workerCodexArgs(project, row, isolated) : ['-c', 'sandbox_mode="workspace-write"']),
    '-c', 'check_for_update_on_startup=false', ...codexEnvironmentArgs({ ...managed, ...toolsEnv }),
    '-c', `projects.${JSON.stringify(row.cwd)}.trust_level="trusted"`];
}
