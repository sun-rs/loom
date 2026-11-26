import { spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { exclusions, isCredentialPath } from './git.mjs';

const sha = /(?<![\w-])(?:[0-9a-f]{40}|[0-9a-f]{64}|[0-9a-f]{7,39})(?![\w-])/gi;
const opaqueReference = /\[loom:[^\]\r\n]+\]|\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi;
const gitReference = /(?:\b(?:git\s+(?:show|rev-parse|checkout|merge|cherry-pick)|sha(?:-?[12])?|commit(?:ted)?|head)|提交(?:号|哈希)?|基线|合入(?:到|至)?)(?:\s*(?:是|为|为：|[:：=@#（(]|\b(?:is|at|to)\b))*\s*$/i;
const noticeLine = /^\s*(?:[-*]\s+)?(?:Loom drift and fact checks|fact-miss\s+\S+\s+·\s+.+)\s*$/i;
const pathToken = /(?<![\w/~@+-])(?:\/?[\w.@+-]+(?:\/[\w.@+-]+)+\/?|[\w.-]+\.[a-z][a-z0-9]{0,9})(?![\w/@+-])/gi;
const named = /\b(tests?|metrics?)(?:\s+names?)?\s*(?::|=|\s)\s*([\x60"'][^\x60"'\r\n]+[\x60"'](?:\s*(?:,|\band\b)\s*[\x60"'][^\x60"'\r\n]+[\x60"'])*)|(?:测试(?:名(?:称)?)?|指标(?:名(?:称)?)?)\s*[:：]?\s*([\x60"'][^\x60"'\r\n]+[\x60"'])/gi;
const bareName = /\b(tests?|metrics?)(?:\s+names?)?\s*[:=]\s*([A-Za-z_][\w:-]*)|(?:测试(?:名(?:称)?)?|指标(?:名(?:称)?)?)\s*[:：]\s*([A-Za-z_][\w:-]*)/gi;
const identifier = /^(?:test[_A-Z]\w*|[a-z]\w*(?:::\w+)+)$/;
const specialFile = /^(?:Makefile|Dockerfile|README|LICENSE|AGENTS\.md|\.gitignore|\.gitattributes)$/i;
const commandPrefix = /^(?:git|loom|npm|node|cargo|pytest|make|cd|npx|pnpm|yarn|bun|go|python[23]?|"?\$LOOM_BIN"?)\s|^-/;
const pathExtensions = new Set('bash bat bz2 c cc cfg cjs cmake conf cpp css csv diff dockerfile env go gz h hpp html ini java js json jsonl jsx kt lock log md mjs patch pdf plist png proto py rb rs sh sql sqlite svg swift tar toml ts tsx txt xml yaml yml zip zsh'.split(' '));
const planned = /(?:\b(?:will|plan to|going to) (?:add|create|write|generate|implement)(?: (?:the )?(?:files?|modules?))?|(?:随后|准备|计划|将|待|接下来)(?:[要再先]?)(?:创建|新建|新增|写入|写|生成|实现))(?:\s*[:：])?\s*(?:[\x60\w./-]+\s*[,、，]\s*)*$/i;
const stillPlanned = /^(?:\s*(?:是|为)?\s*(?:待实现|待新建|尚未实现|尚未创建|计划新增)|\s+(?:(?:is|are)\s+(?:planned|not yet (?:created|implemented))|will be (?:created|implemented))\b)/i;
const cardCreation = /^\s*(?:[-*]|\d+\.)?\s*(?:add|create|implement|generate|新增|创建|新建|新写|补写|实现)\s*[:：]?\s*$/i;
const ratio = /^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/;
const oid = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const quotedSha = /^(?:[a-f0-9]{7,40}|[a-f0-9]{64})$/i;
const nameSources = 'mjs cjs js jsx ts tsx py go rs java kt swift rb php c cc h cpp cs sh bats sql yml yaml json toml proto prom'
  .split(' ').map(ext => ':(glob)**/*.' + ext);
const git = (cwd, ...args) => spawnSync('git', ['--no-optional-locks', ...args], {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
});

function inside(root, path) {
  const part = relative(root, path);
  return !isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`);
}

function pathStat(path, boundary) {
  if (boundary && !inside(boundary, path) || isCredentialPath(path.replace(/^\//, ''))) return;
  try {
    const canonical = realpathSync(path);
    if ((!boundary || inside(boundary, canonical)) && !isCredentialPath(canonical.replace(/^\//, ''))) {
      return statSync(canonical);
    }
  } catch { /* Missing or inaccessible. */ }
}

function pathFacts(roots, gitRoot, snapshot, boundary) {
  const ref = snapshot?.tree ?? snapshot?.head;
  const tree = oid.test(ref ?? '') ? ref : undefined;
  const atEnd = path => Boolean(tree && gitRoot && git(gitRoot, 'cat-file', '-e', `${tree}:${path}`).status === 0);
  const firstDir = token => token.replace(/^\.\//, '').split('/')[0];
  function checkable(token) {
    if (ratio.test(token) || isCredentialPath(token.replace(/^\//, ''))) return false;
    if (specialFile.test(basename(token)) || pathExtensions.has(extname(token).slice(1).toLowerCase())) return true;
    if (isAbsolute(token)) return /^\/[\w.@+-]/.test(token);
    if (!token.includes('/')) return false;
    const prefix = firstDir(token);
    return Boolean(prefix && (roots.some(root => pathStat(resolve(root, prefix), boundary)?.isDirectory()) || atEnd(prefix)));
  }
  function found(token) {
    const paths = isAbsolute(token) ? [resolve(token)] : roots.map(root => resolve(root, token))
      .filter(path => roots.some(root => inside(root, path)));
    if (paths.some(path => pathStat(path, boundary))) return true;
    if (isAbsolute(token) && !roots.some(root => inside(root, paths[0]))) return boundary ? false : null;
    return Boolean(gitRoot && paths.some(path => {
      if (!inside(gitRoot, path) || boundary && !inside(boundary, path)) return false;
      const key = relative(gitRoot, path);
      return snapshot?.files?.some(file => ['A', '?', 'C', 'R'].includes(file.status) &&
        (file.path === key || key && file.path.startsWith(`${key}/`))) || atEnd(key);
    }));
  }
  return { checkable, found };
}

function hasName(roots, name) {
  const symbol = name.split('::').at(-1);
  return roots.some(root => git(root, 'grep', '-I', '-l', '-F', '-w', '--untracked', '--exclude-standard', '-e', symbol, '--',
    ...nameSources,
    ':(exclude,glob)**/tasks/**', ':(exclude,glob)**/docs/**', ':(exclude,glob)**/.project/**', ...exclusions).status === 0);
}

export function plannedCardPaths(card) {
  const paths = new Set();
  for (const line of card.split(/\r?\n/)) {
    if (/^\s*>/.test(line)) continue;
    for (const match of line.matchAll(pathToken)) {
      if (!match[0].includes('/')) continue;
      const before = line.slice(0, match.index).trimEnd().replace(/\x60$/, '');
      if (planned.test(before) || cardCreation.test(before) || stillPlanned.test(line.slice(match.index + match[0].length).replace(/^\x60/, ''))) {
        paths.add(match[0].replace(/^\.\//, ''));
      }
    }
  }
  return paths;
}

export function checkFacts(body, cwd, project = cwd, snapshot,
  { pathBoundary, quotedMisses = [], noticeIds, plannedPaths, locationsOnly = false } = {}) {
  const gitRoot = cwd && git(cwd, 'rev-parse', '--show-toplevel').stdout?.trim();
  const roots = [...new Set([gitRoot, cwd, project].filter(Boolean))];
  const { checkable, found } = pathFacts(roots, gitRoot, snapshot, pathBoundary);
  const text = (body ?? '').split(/\r?\n/).filter(line => !/^\s*>/.test(line) && !noticeLine.test(line)).join('\n')
    .replace(opaqueReference, '').replace(/\b(?:https?|file):\/\/[^\s\x60<>)]+/gi, '');
  const facts = new Map();
  const ignore = new Set(quotedMisses.map(({ kind, value }) => JSON.stringify([kind, value])));
  const add = (kind, value) => {
    if (locationsOnly && kind !== 'sha' && kind !== 'path') return;
    const key = JSON.stringify([kind, value]);
    if (!ignore.has(key)) facts.set(key, { kind, value });
  };
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
  const addPath = (value, offset, end = offset + value.length) => {
    const token = value.replace(/:\d+(?::\d+)?$/, '').replace(/[.,;:]+$/, '').replace(/\/$/, '');
    const start = Math.max(prose.lastIndexOf('\n', offset) + 1, offset - 180);
    if (token.length <= 512 && (pathBoundary || token.includes('/')) && checkable(token) &&
        (pathBoundary && !locationsOnly || !plannedPaths?.has(token.replace(/^\.\//, '')) &&
          !planned.test(prose.slice(start, offset)) && !stillPlanned.test(prose.slice(end)))) {
      add('path', token);
    }
  };
  prose = prose.replace(/\x60([^\x60\r\n]+)\x60/g, (quoted, value, offset) => {
    const token = value.trim();
    if (identifier.test(token)) {
      add('test', token);
      return '';
    }
    const first = token.split(/\s/, 1)[0];
    const firstStat = first !== token && pathStat(resolve(cwd ?? project ?? '.', first), pathBoundary);
    const command = commandPrefix.test(token) || /\s--?\S/.test(token) || first !== token &&
      (/\/bin\//.test(first) || firstStat?.isFile() && (firstStat.mode & 0o111) !== 0);
    if (!command && (first === token || token.includes('/') || pathExtensions.has(extname(token).slice(1).toLowerCase()))) {
      addPath(token, offset, offset + quoted.length);
    }
    return !command && quotedSha.test(token) ? token : ' ';
  });
  prose = prose.replace(pathToken, (value, offset) => {
    addPath(value, offset);
    return ' ';
  });
  for (const match of prose.matchAll(sha)) {
    const value = match[0].toLowerCase();
    if (noticeIds?.has(value)) continue;
    const start = Math.max(prose.lastIndexOf('\n', match.index) + 1, match.index - 100);
    if (gitReference.test(prose.slice(start, match.index)) || pathBoundary && /[a-f]/.test(value) ||
        oid.test(match[0]) && !/(?:\b(?:digest|sha256|delivery|notice|id)\b|投递|通知|摘要)\s*[:：=]?\s*$/i.test(prose.slice(start, match.index))) {
      add('sha', value);
    }
  }
  const misses = [];
  let checked = 0;
  for (const fact of [...facts.values()].slice(0, 100)) {
    const { kind, value } = fact;
    const exists = kind === 'path' ? found(value) : kind === 'sha' ?
      roots.some(root => git(root, 'cat-file', '-e', value).status === 0) : hasName(roots, value);
    if (exists === null) continue;
    checked++;
    if (!exists) misses.push(fact);
  }
  return { checked, misses };
}
