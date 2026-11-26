import { createHash } from 'node:crypto';

export const denialIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
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
