import { spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { exclusions, isCredentialPath } from './git.mjs';

const sha = /(?<![\w-])(?:[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{7,39})(?![\w-])/gi;
const pathToken = /(?:[A-Za-z0-9_.@+-]+\/)+[A-Za-z0-9_.@+-]+\/?|\/[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)+\/?|[A-Za-z0-9_-]+\.(?:[A-Za-z0-9_-]+\.)*[a-z][a-z0-9]{0,9}/gi;
const named = /\b(tests?|metrics?)(?:\s+names?)?\s*(?::|=|\s)\s*([\x60"'][^\x60"'\r\n]+[\x60"'](?:\s*(?:,|\band\b)\s*[\x60"'][^\x60"'\r\n]+[\x60"'])*)|(?:测试(?:名(?:称)?)?|指标(?:名(?:称)?)?)\s*[:：]?\s*([\x60"'][^\x60"'\r\n]+[\x60"'])/gi;
const bareName = /\b(tests?|metrics?)(?:\s+names?)?\s*[:=]\s*([A-Za-z_][\w:-]*)|(?:测试(?:名(?:称)?)?|指标(?:名(?:称)?)?)\s*[:：]\s*([A-Za-z_][\w:-]*)/gi;
const identifier = /^(?:test[_A-Z]\w*|[a-z]\w*(?:::\w+)+)$/;
const specialFile = /^(?:Makefile|Dockerfile|README|LICENSE|AGENTS\.md|\.gitignore|\.gitattributes)$/i;
const commandPrefix = /^(?:git|npm|node|cargo|pytest|make|cd|npx|pnpm|yarn|bun|go|python[23]?)\s/;
const nameSources = 'mjs cjs js jsx ts tsx py go rs java kt swift rb php c cc h cpp cs sh bats sql yml yaml json toml proto prom'
  .split(' ').map(ext => ':(glob)**/*.' + ext);
const git = (cwd, ...args) => spawnSync('git', ['--no-optional-locks', ...args], {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
});

function inside(root, path) {
  const part = relative(root, path);
  return !isAbsolute(part) && part !== '..' && !part.startsWith('../');
}

function pathExists(roots, token) {
  return roots.some(root => {
    const path = resolve(root, token);
    if (!inside(root, path) || isCredentialPath(relative(root, path))) return false;
    try {
      const canonical = realpathSync(path);
      return inside(root, canonical) && !isCredentialPath(relative(root, canonical)) && Boolean(statSync(canonical));
    } catch { return false; }
  });
}

function hasName(roots, name) {
  const symbol = name.split('::').at(-1);
  return roots.some(root => git(root, 'grep', '-I', '-l', '-F', '-w', '--untracked', '--exclude-standard', '-e', symbol, '--',
    ...nameSources,
    ':(exclude,glob)**/tasks/**', ':(exclude,glob)**/docs/**', ':(exclude,glob)**/.project/**', ...exclusions).status === 0);
}

export function checkFacts(body, cwd, project = cwd) {
  const roots = [...new Set([cwd && (git(cwd, 'rev-parse', '--show-toplevel').stdout?.trim() || cwd), cwd, project].filter(Boolean))];
  const text = (body ?? '').replace(/^\s*>[^\r\n]*$/gm, '').replace(/\b(?:https?|file):\/\/[^\s\x60<>)]+/gi, '');
  const facts = new Map();
  const add = (kind, value) => facts.set(JSON.stringify([kind, value]), { kind, value });
  let prose = text.replace(named, (_, kind, english, chinese, offset) => {
    const label = kind?.toLowerCase().replace(/s$/, '') ?? (/^测试/.test(text.slice(offset)) ? 'test' : 'metric');
    const commands = [];
    for (const [token, value] of (english ?? chinese).matchAll(/[\x60"']([^\x60"'\r\n]+)[\x60"']/g)) {
      if (commandPrefix.test(value) || /^(?:[.\w-]+\/)+[.\w-]+$|\.(?:mjs|js|ts|py|go|rb|rs|java|sh)$/.test(value)) commands.push(token);
      else if (value.length <= 160) add(label, value);
    }
    return commands.join(' ');
  });
  prose = prose.replace(bareName, (_, kind, english, chinese, offset) => {
    const value = english ?? chinese;
    if (!['passed', 'failed', 'ok', 'pass', 'none', 'n/a', 'green'].includes(value.toLowerCase())) {
      add(kind ? kind.toLowerCase().replace(/s$/, '') : /^测试/.test(text.slice(offset)) ? 'test' : 'metric', value);
    }
    return '';
  });
  prose = prose.replace(/\x60([^\x60\r\n]+)\x60/g, (quoted, token) => {
    if (identifier.test(token)) {
      add('test', token);
      return '';
    }
    if (specialFile.test(token) || token.includes(' ') && /[/]|\.[a-z0-9]{1,9}$/i.test(token) &&
        !commandPrefix.test(token)) {
      add('path', token.replace(/:\d+(?::\d+)?$/, ''));
      return '';
    }
    return quoted;
  });
  prose = prose.replace(pathToken, (value, offset) => {
    const plainPair = /^[a-z]+\/[a-z]+$/.test(value) && prose[offset - 1] !== '\x60' && !pathExists(roots, value);
    if (value.length <= 512 && !plainPair && !isCredentialPath(value.replace(/^\//, '')) &&
        (/[/]/.test(value) || /(?:^|[\s(\x60])[\w.-]+\.[a-z][a-z0-9]{0,9}$/i.test(prose.slice(Math.max(0, offset - 1), offset + value.length)))) {
      add('path', value);
    }
    return ' ';
  });
  for (const match of prose.matchAll(sha)) {
    if (/[a-f]/i.test(match[0]) || match[0].length >= 40 || /\b(?:sha|commit|head)\s*[:=]?\s*$/i.test(prose.slice(0, match.index))) {
      add('sha', match[0].toLowerCase());
    }
  }
  const misses = [];
  let checked = 0;
  for (const fact of [...facts.values()].slice(0, 100)) {
    const { kind, value } = fact;
    if (kind === 'path' && isCredentialPath(value.replace(/^\//, ''))) continue;
    checked++;
    const found = kind === 'path' ? pathExists(roots, value) : kind === 'sha' ?
      roots.some(root => git(root, 'cat-file', '-e', value).status === 0) : hasName(roots, value);
    if (!found) misses.push(fact);
  }
  return { checked, misses };
}
