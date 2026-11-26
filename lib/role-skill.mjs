import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const skillRoot = fileURLToPath(new URL('../skills/loom', import.meta.url));
export const skillRoles = ['super', 'auditor', 'leader', 'worker'];
export const maxCoreTokens = 1500;
export const maxModuleTokens = 500;
export const maxSkillModules = 2;
export const skillModuleNames = ['gate-judgment', 'gate-pack', 'needs-decision', 'reject-routing',
  'rotation', 'rotation-activation', 'rotation-verify', 'successor', 'worker-integration',
  'escalation', 'delivery-uncertain', 'host-tier', 'close', 'worker-denied', 'worker-resume',
  'senior-recovery', 'containment', 'post-compaction'];
const priority = new Map([
  ['successor', 0], ['rotation-verify', 0], ['rotation-activation', 0], ['rotation', 0],
  ['post-compaction', 0], ['reject-routing', 1], ['worker-resume', 1], ['needs-decision', 2],
]);

const readPart = (root, dir, name) => readFileSync(join(root, dir, name + '.md'), 'utf8').trimEnd();
export const stripSkillComments = text => text.replace(/<!--[\s\S]*?-->/g, '').trimEnd();

export function assembleRoleCore(common, core) {
  return common.trimEnd() + '\n\n' + core.replaceAll('](../references/', '](references/')
    .replaceAll('](../../../docs/HEADLESS.md)', '](../../docs/HEADLESS.md)');
}

export function roleCore(role, root = skillRoot) {
  if (!skillRoles.includes(role)) throw new RangeError('Unknown Loom skill role');
  return assembleRoleCore(readPart(root, 'roles', 'common'), readPart(root, 'roles', role));
}

export function skillModules(names, root = skillRoot) {
  const ranked = [...new Set(names.filter(Boolean))];
  if (ranked.some(name => !skillModuleNames.includes(name))) throw new RangeError('Unknown Loom skill module');
  ranked.sort((a, b) => (priority.get(a) ?? 3) - (priority.get(b) ?? 3));
  const selected = ranked.slice(0, maxSkillModules);
  const deferred = ranked.slice(maxSkillModules);
  const parts = selected.map(name =>
    `[loom-skill:${name}]\n${stripSkillComments(readPart(root, 'modules', name))}`);
  if (deferred.length) parts.push(`另有模块 ${deferred.join('、')} 未附，随下一次常规投递附上。`);
  return { names: selected, deferred, text: parts.join('\n\n') };
}
