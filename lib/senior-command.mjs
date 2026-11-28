import { createHash } from 'node:crypto';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isCredentialPath } from '../evidence/git.mjs';

export const denialIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const maxOverrideLines = 200;
const digest = value => createHash('sha256').update(value).digest('hex');
export const legacySeniorCommandKey = command => digest(command.trim());

// Canonicalize only literal argv. Pipelines, assignments, shell expansions
// and other shell syntax retain their exact source as the binding.
export function literalShellArgv(text) {
  const argv = [];
  let quote, word = '', started = false;
  const push = () => {
    if (started) argv.push(word);
    word = '';
    started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote === "'") {
      if (char === quote) quote = undefined;
      else word += char;
      continue;
    }
    if (char === '\\') {
      const next = text[++i];
      if (next === undefined) return;
      if (next === '\n') continue;
      word += quote === '"' && !'$"`\\'.includes(next) ? char + next : next;
      started = true;
      continue;
    }
    if (quote === '"') {
      if (char === quote) quote = undefined;
      else if (char === '$' || char === '`') return;
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === ' ' || char === '\t') push();
    else if (/[^\S \t]|[;&|<>()$`*?\[\]{}~#!]/.test(char)) return;
    else {
      word += char;
      started = true;
    }
  }
  if (quote) return;
  push();
  if (!argv.length || !argv[0] || /^[A-Za-z_]\w*=/.test(argv[0]) ||
      ['if', 'then', 'else', 'elif', 'fi', 'case', 'esac', 'for', 'while', 'until', 'do', 'done', 'in', 'function',
        'select', 'time', 'alias', 'unalias'].includes(argv[0])) return;
  return argv;
}

export function seniorCommandKey(command) {
  if (typeof command !== 'string') return;
  const argv = literalShellArgv(command);
  return argv ? 'argv:' + digest(JSON.stringify(argv)) : 'text:' + digest(command);
}

const words = new Intl.Segmenter(undefined, { granularity: 'word' });
export function seniorOverrideReason(reason) {
  if (typeof reason !== 'string' || reason.length > 300 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(reason)) return;
  const text = reason.trim().replace(/\s+/gu, ' ');
  if ([...words.segment(text)].filter(part => part.isWordLike).length < 3 ||
      (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < 8) return;
  return text;
}

const withinRoot = (root, path) => {
  const part = relative(root, path);
  return !isAbsolute(part) && part !== '..' && !part.startsWith('../');
};

export function parseOverrideLines(value) {
  if (typeof value !== 'string') {
    return { ok: false, code: 'senior-override-target-required', message: 'Specify --lines START-END (max 200 lines).' };
  }
  const match = /^([1-9]\d*)-([1-9]\d*)$/.exec(value.trim());
  if (!match) {
    return { ok: false, code: 'senior-override-target-required', message: 'Specify --lines START-END with positive line numbers.' };
  }
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) {
    return { ok: false, code: 'senior-override-target-required', message: 'Line range end must be >= start.' };
  }
  const count = end - start + 1;
  if (count > maxOverrideLines) {
    return { ok: false, code: 'senior-override-range-exceeded', count, message: `Line range ${start}-${end} (${count} lines) exceeds max ${maxOverrideLines} lines.` };
  }
  return { ok: true, start, end, count, range: `${start}-${end}` };
}

export function parseOverrideFile(project, cwd, value) {
  if (typeof value !== 'string') {
    return { ok: false, code: 'senior-override-target-required', message: 'Specify one unique project file with --file PATH.' };
  }
  const raw = value.trim();
  if (!raw || /[\x00-\x1f\x7f-\x9f$`*?\[\]{},;|\n\r]/.test(raw)) {
    return { ok: false, code: 'senior-override-target-required', message: 'Target --file must be one literal project file path without wildcards.' };
  }
  const expanded = raw.startsWith('$LOOM_PROJECT/') ? join(project, raw.slice(14)) : raw;
  const projectReal = realpathSync(project);
  let resolved = resolve(cwd, expanded);
  if (!existsSync(resolved) && cwd !== project && existsSync(resolve(project, expanded))) {
    resolved = resolve(project, expanded);
  }
  if (!withinRoot(project, resolved) || resolved === resolve(project)) {
    return { ok: false, code: 'senior-override-target-required', message: 'Target --file must be a single file inside the project.' };
  }
  const rel = relative(project, resolved);
  if (!rel || isCredentialPath(rel)) {
    return { ok: false, code: 'senior-override-target-required', message: 'Target --file cannot be a credential path.' };
  }
  try {
    if (existsSync(resolved)) {
      const real = realpathSync(resolved);
      if (!withinRoot(projectReal, real) || real === projectReal || statSync(real).isDirectory()) {
        return { ok: false, code: 'senior-override-target-required', message: 'Target --file must be a single project file, not a directory.' };
      }
      return { ok: true, path: real, relative: relative(projectReal, real) };
    }
    let parent = dirname(resolved);
    while (!existsSync(parent) && parent !== dirname(parent)) parent = dirname(parent);
    if (!withinRoot(projectReal, realpathSync(parent))) {
      return { ok: false, code: 'senior-override-target-required', message: 'Target --file must stay inside the project.' };
    }
    return { ok: true, path: resolved, relative: rel };
  } catch {
    return { ok: false, code: 'senior-override-target-required', message: 'Target --file could not be resolved inside the project.' };
  }
}
