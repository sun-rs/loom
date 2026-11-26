import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const skillRoot = fileURLToPath(new URL('../skills/loom', import.meta.url));
export const skillRoles = ['super', 'auditor', 'leader', 'worker'];
export const maxCoreTokens = 1500;
export const maxModuleTokens = 500;
export const maxSkillModules = 2;
export const skillModuleNames = ['gate-judgment', 'gate-pack', 'needs-decision', 'reject-routing',
  'rotation', 'rotation-activation', 'rotation-verify', 'successor', 'worker-integration'];

const readPart = (root, dir, name) => readFileSync(join(root, dir, name + '.md'), 'utf8').trimEnd();

export function assembleRoleCore(common, core) {
  return common.trimEnd() + '\n\n' + core.replaceAll('](../references/', '](references/');
}

export function roleCore(role, root = skillRoot) {
  if (!skillRoles.includes(role)) throw new RangeError('Unknown Loom skill role');
  return assembleRoleCore(readPart(root, 'roles', 'common'), readPart(root, 'roles', role));
}

export function skillModules(names, root = skillRoot) {
  const selected = [...new Set(names.filter(Boolean))].slice(0, maxSkillModules);
  if (selected.some(name => !skillModuleNames.includes(name))) throw new RangeError('Unknown Loom skill module');
  const text = selected.map(name => `[loom-skill:${name}]\n${readPart(root, 'modules', name)}`).join('\n\n');
  return { names: selected, text };
}
