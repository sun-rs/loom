import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { estimateTokens } from '../lib/token-budget.mjs';
import { maxCoreTokens, maxModuleTokens, roleCore, skillModuleNames, skillRoles } from '../lib/role-skill.mjs';

const rootPath = 'skills/loom';
const moduleSources = ['daemon/sessions.mjs', 'daemon/self-rotation.mjs', 'daemon/supervisor.mjs', 'daemon/skill-events.mjs'];
const component = /^(?:roles|references)\/[a-z][a-z-]*\.md$/;

export function lintSkill(project) {
  const root = join(project, rootPath);
  if (!existsSync(join(root, 'roles')) &&
      (!existsSync(join(root, 'SKILL.md')) || !readFileSync(join(root, 'SKILL.md'), 'utf8').includes('roles/common.md'))) return [];
  const violations = [];
  const add = (file, line, message) => violations.push({ file: `${rootPath}/${file}`, line, column: 1, rule: 'skill', message });
  const numbered = new Map();
  const statements = new Map();
  const constraints = new Map();
  const read = path => readFileSync(join(root, path), 'utf8');
  const roles = ['common', ...skillRoles].map(role => `roles/${role}.md`);
  const list = dir => existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter(file => file.endsWith('.md')) : [];
  const modules = [...new Set([...list('modules'), ...skillModuleNames.map(name => name + '.md')])]
    .map(file => 'modules/' + file);
  const sources = moduleSources.filter(path => existsSync(join(project, path)))
    .map(path => readFileSync(join(project, path), 'utf8')).join('\n');
  for (const file of ['SKILL.md', ...roles, ...modules, ...list('references').map(name => 'references/' + name)]) {
    if (!existsSync(join(root, file))) {
      add(file, 1, 'Restore the required Loom skill component.');
      continue;
    }
    const source = read(file);
    for (const [i, line] of source.split('\n').entries()) {
      for (const [, target] of line.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        if (file === 'roles/worker.md' && target === '../../../docs/HEADLESS.md' &&
            existsSync(join(project, 'docs/HEADLESS.md'))) continue;
        const destination = posix.normalize(posix.join(posix.dirname(file), target));
        if (!component.test(destination) || /^(?:modules|references)\//.test(file) || !existsSync(join(root, destination))) {
          add(file, i + 1, 'Use a resolvable, one-level role or reference link. Deliver module steps inline.');
        }
      }
      const numberedLine = /^(\d+)\.\s+(.+)/.exec(line);
      if (!numberedLine || file === 'SKILL.md' || file.startsWith('references/')) continue;
      const [, id, text] = numberedLine;
      if (numbered.has(id)) add(file, i + 1, `Give rule ${id} a unique ID (already at ${numbered.get(id)}).`);
      else numbered.set(id, `${file}:${i + 1}`);
      if (statements.has(text)) add(file, i + 1, `Keep this exact rule once (already at ${statements.get(text)}).`);
      else statements.set(text, `${file}:${i + 1}`);
      const permission = /^(允许|禁止)([^。]+)。?$/.exec(text);
      if (permission) {
        const [, action, subject] = permission;
        if (constraints.has(subject) && constraints.get(subject) !== action) add(file, i + 1, 'Resolve the conflicting permission.');
        constraints.set(subject, action);
      }
    }
    if (file.startsWith('modules/')) {
      if (estimateTokens(source) > maxModuleTokens) add(file, 1, `Keep the module at or below ${maxModuleTokens} estimated tokens.`);
      const name = file.slice(8, -3);
      if (!skillModuleNames.includes(name) || !sources.includes(`'${name}'`)) add(file, 1, 'Attach this module to a daemon event.');
    }
  }
  for (const role of skillRoles) {
    if (!existsSync(join(root, 'roles', role + '.md')) || !existsSync(join(root, 'roles/common.md'))) continue;
    const core = roleCore(role, root);
    if (estimateTokens(core) > maxCoreTokens || core.split('\n').length > 120) {
      add(`roles/${role}.md`, 1, `Keep the assembled core under ${maxCoreTokens} estimated tokens and 120 lines.`);
    }
  }
  return violations;
}
