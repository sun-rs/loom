import { randomUUID } from 'node:crypto';
import { appendFileSync, constants, existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { readText } from '../daemon/io.mjs';
import { isCredentialPath } from '../evidence/git.mjs';

import { seniorCommandKey } from './senior-command.mjs';

const denialSpecs = {
  'test-build': ['运行测试或构建', '派 Worker 卡执行并查 .project/evidence 证据卡'],
  'git-integration': ['直接执行 Git 合入或集成', '派集成 Worker 卡执行并查门禁包'],
  'state-poll': ['轮询 loom state', '结束本轮等待推送，或单次运行 "$LOOM_BIN" status'],
  'source-search': ['广域搜索仓库源码', '查 .project/ 证据与 git diff --stat，或派 Worker 卡'],
  'source-read': ['读取整文件、补丁或项目外路径', 'Read/sed/head/git show 单文件 ≤200 行，或查 .project/ 证据'],
  'unclassified-tool': ['执行未放行命令或脚本', '用 "$LOOM_BIN"、只读 Git 元数据、.project/ 查询或派 Worker 卡'],
};
const gitMetaFlag = /^(?:--(?:stat|shortstat|numstat|name-only|name-status)(?:=|$)|--no-patch$|-s$)/;
const gitPatchFlag = /^(?:-p(?:$|[0-9])|--(?:patch|stat-with-patch|ext-diff|textconv|output)(?:=|$))/;
const within = (root, path) => {
  const part = relative(root, path);
  return !isAbsolute(part) && part !== '..' && !part.startsWith('../');
};
const expandProjectVar = (project, value) => {
  if (value === '$LOOM_PROJECT') return project;
  if (typeof value === 'string' && value.startsWith('$LOOM_PROJECT/')) return join(project, value.slice(14));
  return value;
};

function projectNote(project, cwd, value, { allowGlob = false } = {}) {
  value = expandProjectVar(project, value);
  if (typeof value !== 'string' || !value || /[$`\[\]{}]/.test(value)) return false;
  const hasGlob = /[*?]/.test(value);
  if (hasGlob && !allowGlob) return false;
  if (value.split('/').includes('..')) return false;
  const root = join(project, '.project');
  const target = resolve(cwd, value);
  if (!within(root, target)) return false;
  let checkPath = target;
  if (hasGlob) {
    const parts = value.split('/');
    const firstWild = parts.findIndex(part => /[*?]/.test(part));
    checkPath = resolve(cwd, firstWild > 0 ? parts.slice(0, firstWild).join('/') : '.');
    if (!within(root, checkPath)) return false;
  }
  try {
    const realRoot = existsSync(root) ? realpathSync(root) : root;
    while (!existsSync(checkPath) && checkPath !== root && checkPath !== dirname(checkPath)) checkPath = dirname(checkPath);
    return within(realRoot, realpathSync(checkPath));
  } catch { return false; }
}

function targetedSource(project, cwd, value) {
  value = expandProjectVar(project, value);
  if (typeof value !== 'string' || !value || /[$`*?\[\]{}]/.test(value)) return false;
  const path = resolve(cwd, value);
  if (!within(project, path)) return false;
  try { return within(realpathSync(project), realpathSync(path)); }
  catch { return false; }
}

const shellWords = /'(?:[^']*)'|"(?:\\.|[^"\\])*"|\\.|&&|\|\||>>|[\s;|&<>]|[^\s'";|&<>\\]+/gy;
export function shellPipelines(text) {
  const pipelines = [[[]]];
  let word = '';
  let started = false;
  let end = 0;
  for (const { 0: token, index } of text.matchAll(shellWords)) {
    if (/^(?:[\t\r ]|\n|&&|\|\||[;|&<>]|>>)$/.test(token)) {
      if (started) pipelines.at(-1).at(-1).push(word);
      started = false;
      word = '';
      if (token === '|') pipelines.at(-1).push([]);
      else if (/^(?:\n|;|&&|\|\||&)$/.test(token)) pipelines.push([[]]);
      if (/^[<>]/.test(token)) pipelines.at(-1).at(-1).push(token);
    } else if (token !== '\\\n') {
      started = true;
      word += /^["']/.test(token) ? token.slice(1, -1) : token.replace(/^\\/, '');
    }
    end = index + token.length;
  }
  if (end !== text.length) return;
  if (started) pipelines.at(-1).at(-1).push(word);
  return pipelines
    .map(pipeline => pipeline.filter(command => command.length))
    .filter(pipeline => pipeline.length);
}

export function shellCommands(text) {
  return shellPipelines(text)?.flat();
}

function stripRedirects(words, project, cwd) {
  const args = [...words];
  while (/^[A-Za-z_][\w]*=/.test(args[0] ?? '')) args.shift();
  if (!args.length) return { executable: null, args: [] };
  const executable = args.shift();
  const redirects = args.flatMap((word, i) => ['<', '>', '>>'].includes(word) ? [args[i + 1]] : []);
  if (redirects.some(path => path !== '/dev/null' && !projectNote(project, cwd, path))) {
    return { executable, args, denied: 'source-read' };
  }
  const cleaned = [];
  for (let i = 0; i < args.length; i++) {
    if (['<', '>', '>>'].includes(args[i])) {
      if (cleaned.length && /^[012]$/.test(cleaned.at(-1))) cleaned.pop();
      i++;
      continue;
    }
    cleaned.push(args[i]);
  }
  return { executable, args: cleaned };
}

function boundedLineSlicer(stage, project, cwd) {
  const { executable, args, denied } = stripRedirects(stage, project, cwd);
  if (denied || !executable) return false;
  const name = basename(executable);
  if (name === 'sed' && args.length === 2 && args[0] === '-n') {
    const range = /^([1-9]\d*)(?:,([1-9]\d*))?p$/.exec(args[1]);
    return Boolean(range && Number(range[2] ?? range[1]) >= Number(range[1]) &&
      Number(range[2] ?? range[1]) - Number(range[1]) + 1 <= 200);
  }
  if (name === 'head') {
    if (args.length === 2 && args[0] === '-n' && /^[1-9]\d*$/.test(args[1]) && Number(args[1]) <= 200) return true;
    if (args.length === 1 && /^-(?:n)?([1-9]\d*)$/.test(args[0]) && Number(args[0].replace(/^-n?/, '')) <= 200) return true;
  }
  return false;
}

function validGitShowFileSpec(args) {
  const specs = args.filter(arg => !arg.startsWith('-'));
  if (specs.length !== 1) return null;
  const spec = specs[0];
  const colon = spec.indexOf(':');
  if (colon <= 0 || colon === spec.length - 1) return null;
  const filePath = spec.slice(colon + 1);
  if (!filePath || filePath.startsWith('/') || /[$`*?\[\]{}:]/.test(filePath) ||
      filePath.split('/').includes('..') || isCredentialPath(filePath)) return null;
  return filePath;
}

function parseFlaggedPositionals(args, valueFlags = new Set(), twoValueFlags = new Set()) {
  const positionals = [];
  let afterDash = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!afterDash && arg === '--') { afterDash = true; continue; }
    if (!afterDash && arg.startsWith('-') && arg !== '-') {
      if (twoValueFlags.has(arg)) { i += 2; continue; }
      if (valueFlags.has(arg)) { i += 1; continue; }
      continue;
    }
    positionals.push(arg);
  }
  return positionals;
}

export function seniorShellCategory(command, cwd, project) {
  if (typeof command !== 'string') return 'unclassified-tool';
  const text = command.replace(/\\\n/g, ' ');
  if (/\b(?:while|until|for)\b[^\n]*(?:\n|;|\bdo\b)[\s\S]*\b(?:loom|LOOM_BIN)["']?\s+state\b/.test(text)) return 'state-poll';
  const pipelines = shellPipelines(text.replace(/\b[12]>&[12]\b/g, ''));
  if (!pipelines?.length) return 'unclassified-tool';
  const commands = pipelines.flat();
  const first = commands[0].filter(word => !word.startsWith('LOOM_SENIOR_OVERRIDE='));
  if (commands.length === 1 && first[1] === 'senior-tool' &&
      (first[0] === '$LOOM_BIN' || first[0] === join(project, '.project', 'loomd', 'bin', 'loom')) &&
      !/\$\(|`|[<>]\(/.test(text.replace(/'[^']*'/g, ''))) return;
  if (/\$\(|`|[<>]\(|\$\{/.test(text)) return 'unclassified-tool';
  for (const pipeline of pipelines) {
    for (let stageIndex = 0; stageIndex < pipeline.length; stageIndex++) {
      const piped = stageIndex > 0;
      const { executable, args, denied } = stripRedirects(pipeline[stageIndex], project, cwd);
      if (denied) return denied;
      if (!executable) continue;
      const name = basename(executable);
      if (['env', 'command', 'exec', 'time', 'timeout', 'nice'].includes(name)) return 'unclassified-tool';
      if (/^(npm|npx|pnpm|yarn|bun|pytest|cargo|go|make|gmake|cmake|ninja|ctest|mvn|gradle|swift|xcodebuild|uv|tox|jest|vitest|tsc|ruff)$/.test(name) ||
          ['node', 'deno', 'python', 'python3', 'ruby'].includes(name) && args.some(arg => /(?:^--test(?:$|[=-])|pytest|(?:^|\.)test\.|\b(?:tests?|probe)[-/])/i.test(arg))) {
        return 'test-build';
      }
      if (name === 'git') {
        while (['-C', '--no-pager', '--no-optional-locks', '--no-replace-objects'].includes(args[0])) {
          if (args[0] === '-C') {
            const targetDir = expandProjectVar(project, args[1] ?? '');
            if (!targetDir || /[$`*?\[\]{}]/.test(targetDir) || !within(project, resolve(cwd, targetDir))) return 'source-read';
          }
          args.splice(0, args[0] === '-C' ? 2 : 1);
        }
        const sub = args.shift();
        if (['merge', 'rebase', 'cherry-pick'].includes(sub) || sub === 'worktree' && args[0] === 'add') return 'git-integration';
        if (sub === 'grep') return 'source-search';
        if (args.some(arg => gitPatchFlag.test(arg))) return 'unclassified-tool';
        if (sub === 'show' && !args.some(arg => gitMetaFlag.test(arg))) {
          if (validGitShowFileSpec(args) && stageIndex + 1 < pipeline.length &&
              boundedLineSlicer(pipeline[stageIndex + 1], project, cwd)) {
            stageIndex++;
            continue;
          }
          return 'source-read';
        }
        if (['diff', 'diff-tree'].includes(sub) && !args.some(arg => gitMetaFlag.test(arg))) return 'source-read';
        if (!['diff', 'diff-tree', 'show', 'log', 'rev-parse', 'status', 'merge-base', 'branch', 'worktree'].includes(sub) ||
            sub === 'branch' && !args.every(arg => arg.startsWith('--show-current') || arg === '--list') ||
            sub === 'worktree' && args[0] !== 'list') return 'unclassified-tool';
        continue;
      }
      if (executable === '$LOOM_BIN' || executable === join(project, '.project', 'loomd', 'bin', 'loom') || executable === 'loom') continue;
      if (['pwd', 'true', 'false', ':', 'echo', 'printf'].includes(name)) continue;
      if (name === 'date') {
        const dash = args.indexOf('--');
        const flagArgs = dash < 0 ? args : args.slice(0, dash);
        if (flagArgs.some(arg => /^(?:--set|--file)(?:=|$)|^-[a-zA-Z]*[sf]/.test(arg))) return 'unclassified-tool';
        continue;
      }
      if (name === 'cd' && args.length === 1) {
        const dest = expandProjectVar(project, args[0]);
        if (!/[$`*?\[\]{}]/.test(dest) && within(project, resolve(cwd, dest))) {
          cwd = resolve(cwd, dest);
          continue;
        }
        return 'unclassified-tool';
      }
      if (['rg', 'grep', 'egrep', 'find', 'fd'].includes(name)) {
        const dash = args.indexOf('--');
        const flagArgs = dash < 0 ? args : args.slice(0, dash);
        if (flagArgs.some(arg => /^(?:--pre|--follow|-exec|-ok|-delete|--files$|--file(?:=|$)|--exclude-from)|^-[a-zA-Z]*[fL]/.test(arg))) return 'source-search';
        if (name === 'find' || name === 'fd') {
          const paths = name === 'find' ? args.slice(0, 1) : parseFlaggedPositionals(args, new Set(['-e', '-t', '-d', '-E'])).slice(1);
          if (!paths.length || !paths.every(path => projectNote(project, cwd, path, { allowGlob: true }))) return 'source-search';
          continue;
        }
        const hasExplicitPattern = flagArgs.some(arg => arg === '-e' || arg === '--regexp' || /^--regexp=/.test(arg) || /^-e.+/.test(arg));
        const recursive = flagArgs.some(arg => /^--recursive$|^-[a-zA-Z]*[rR]/.test(arg));
        const positionals = parseFlaggedPositionals(args, new Set([
          '-e', '--regexp', '-A', '-B', '-C', '-m', '--max-count', '--after-context', '--before-context', '--context',
          '-g', '--glob', '-t', '--type', '--color', '--colour', '--label',
        ]));
        const paths = hasExplicitPattern ? positionals : positionals.slice(1);
        if (!paths.length) {
          if (piped && !recursive) continue;
          return 'source-search';
        }
        if (!paths.every(path => projectNote(project, cwd, path, { allowGlob: true }))) return 'source-search';
        continue;
      }
      if (name === 'jq') {
        const dash = args.indexOf('--');
        const flagArgs = dash < 0 ? args : args.slice(0, dash);
        if (flagArgs.some(arg => /^(?:--from-file|--argfile|--rawfile|--slurpfile|--library-path)(?:=|$)|^-[a-zA-Z]*[fL]/.test(arg))) return 'source-read';
        const positionals = parseFlaggedPositionals(args, new Set(['--indent']), new Set(['--arg', '--argjson']));
        const paths = positionals.slice(1);
        if (!paths.length) {
          if (piped) continue;
          return 'source-read';
        }
        if (!paths.every(path => projectNote(project, cwd, path, { allowGlob: true }))) return 'source-read';
        continue;
      }
      if (name === 'tr') {
        if (piped) continue;
        return 'unclassified-tool';
      }
      if (['cut', 'sort', 'uniq'].includes(name)) {
        const dash = args.indexOf('--');
        const flagArgs = dash < 0 ? args : args.slice(0, dash);
        if (name === 'sort' && flagArgs.some(arg => /^(?:--output|--files0-from|--compress-program)(?:=|$)|^-[a-zA-Z]*o/.test(arg))) return 'source-read';
        const valueFlags = name === 'cut' ? new Set(['-b', '-c', '-f', '-d']) :
          name === 'sort' ? new Set(['-k', '-t', '-T', '-S']) : new Set(['-f', '-s', '-w']);
        const paths = parseFlaggedPositionals(args, valueFlags);
        if (!paths.length) {
          if (piped) continue;
          return 'source-read';
        }
        if (!paths.every(path => projectNote(project, cwd, path, { allowGlob: true }))) return 'source-read';
        continue;
      }
      if (name === 'sed' && args.length === 3 && args[0] === '-n') {
        const range = /^([1-9]\d*)(?:,([1-9]\d*))?p$/.exec(args[1]);
        if (range && Number(range[2] ?? range[1]) >= Number(range[1]) &&
            Number(range[2] ?? range[1]) - Number(range[1]) + 1 <= 200 && targetedSource(project, cwd, args[2])) continue;
      }
      if (['head', 'tail'].includes(name)) {
        if (args.length === 3 && args[0] === '-n' && /^[1-9]\d*$/.test(args[1]) && Number(args[1]) <= 200 && targetedSource(project, cwd, args[2])) continue;
        if (args.length === 2 && /^-([1-9]\d*)$/.test(args[0]) && Number(args[0].slice(1)) <= 200 && targetedSource(project, cwd, args[1])) continue;
      }
      if (['cat', 'head', 'tail', 'wc', 'ls', 'stat', 'shasum', 'sha256sum'].includes(name)) {
        const valueFlags = ['head', 'tail'].includes(name) ? new Set(['-n', '-c']) :
          name === 'shasum' ? new Set(['-a']) : new Set();
        const paths = parseFlaggedPositionals(args, valueFlags).filter(arg => arg !== '/dev/null');
        if (!paths.length) {
          if (['ls', 'stat'].includes(name)) {
            if (projectNote(project, cwd, '.')) continue;
            return 'source-read';
          }
          continue;
        }
        if (paths.every(arg => projectNote(project, cwd, arg, { allowGlob: true }))) continue;
        return 'source-read';
      }
      return 'unclassified-tool';
    }
  }
}

export function overrideCommandTargets(command, cwd, project) {
  if (typeof command !== 'string') return { files: [], exceedsLimit: false };
  const pipelines = shellPipelines(command.replace(/\\\n/g, ' ').replace(/\b[12]>&[12]\b/g, ''));
  if (!pipelines?.length) return { files: [], exceedsLimit: false };
  let activeCwd = cwd;
  const files = new Set();
  let exceedsLimit = false;
  for (const pipeline of pipelines) {
    for (const stage of pipeline) {
      const { executable, args } = stripRedirects(stage, project, activeCwd);
      if (!executable) continue;
      const name = basename(executable);
      if (name === 'cd' && args.length === 1) {
        const dest = expandProjectVar(project, args[0]);
        if (!/[$`*?\[\]{}]/.test(dest) && within(project, resolve(activeCwd, dest))) activeCwd = resolve(activeCwd, dest);
        continue;
      }
      if (name === 'sed') {
        for (const arg of args) {
          const range = /^([1-9]\d*),([1-9]\d*)p$/.exec(arg);
          if (range && Number(range[2]) - Number(range[1]) + 1 > 200) exceedsLimit = true;
        }
        const positionals = parseFlaggedPositionals(args, new Set(['-e', '-f']));
        const fileArgs = args.includes('-e') ? positionals : positionals.slice(1);
        for (const p of fileArgs) if (!projectNote(project, activeCwd, p, { allowGlob: true })) files.add(resolve(activeCwd, expandProjectVar(project, p)));
      } else if (['head', 'tail', 'cat'].includes(name)) {
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-n' && /^[1-9]\d*$/.test(args[i + 1] ?? '') && Number(args[i + 1]) > 200) exceedsLimit = true;
          if (/^-([1-9]\d*)$/.test(args[i]) && Number(args[i].slice(1)) > 200) exceedsLimit = true;
        }
        const valueFlags = name === 'cat' ? new Set() : new Set(['-n', '-c']);
        for (const p of parseFlaggedPositionals(args, valueFlags)) {
          if (p !== '/dev/null' && !projectNote(project, activeCwd, p, { allowGlob: true })) {
            files.add(resolve(activeCwd, expandProjectVar(project, p)));
          }
        }
      } else if (name === 'git') {
        let gitCwd = activeCwd;
        const gargs = [...args];
        while (['-C', '--no-pager', '--no-optional-locks', '--no-replace-objects'].includes(gargs[0])) {
          if (gargs[0] === '-C' && gargs[1]) gitCwd = resolve(activeCwd, expandProjectVar(project, gargs[1]));
          gargs.splice(0, gargs[0] === '-C' ? 2 : 1);
        }
        const sub = gargs.shift();
        if (sub === 'show') {
          for (const arg of gargs) {
            if (!arg.startsWith('-') && arg.includes(':')) {
              const target = arg.slice(arg.indexOf(':') + 1);
              if (target && !projectNote(project, gitCwd, target, { allowGlob: true })) files.add(resolve(gitCwd, target));
            }
          }
        } else if (sub === 'diff') {
          const dash = gargs.indexOf('--');
          if (dash >= 0) {
            for (const p of gargs.slice(dash + 1)) {
              if (!projectNote(project, gitCwd, p, { allowGlob: true })) files.add(resolve(gitCwd, p));
            }
          }
        }
      }
    }
  }
  return { files: [...files], exceedsLimit };
}

export function seniorToolCategory(name, input = {}, cwd, project) {
  input ??= {};
  const value = name?.toLowerCase() ?? '';
  const command = input.command ?? input.cmd ?? input.CommandLine;
  if (value === 'apply_patch' && typeof command === 'string') {
    const paths = [...command.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(match => match[1]);
    return paths.length && paths.every(path => projectNote(project, cwd, path)) ? undefined : 'source-read';
  }
  if (command !== undefined || /^(bash|shell|exec_command|run_command|terminal)$/.test(value)) {
    if (Array.isArray(command)) {
      if (command.length === 3 && /^(?:ba|z)?sh$/.test(basename(command[0])) && /^-l?c$/.test(command[1])) {
        return seniorShellCategory(command[2], input.workdir ?? cwd, project);
      }
      return 'unclassified-tool';
    }
    return seniorShellCategory(command, input.workdir ?? input.cwd ?? cwd, project);
  }
  if (/apply_patch|write|edit|read|view|search|grep|glob|outline|list_dir/.test(value)) {
    const search = /search|grep|glob|outline/.test(value);
    const paths = Array.isArray(input.paths) ? input.paths : Array.isArray(input.queries) ?
      input.queries.map(query => query.path ?? query.Path) :
      [input.file_path ?? input.filePath ?? input.path ?? input.Path ?? input.TargetFile ?? input.AbsolutePath];
    const start = input.start_line ?? input.startLine ?? input.StartLine ?? input.Offset ?? input.offset;
    const end = input.end_line ?? input.endLine ?? input.EndLine;
    const limit = input.limit ?? input.Limit ?? input.line_count ?? input.LineCount ?? (end - (start ?? 1) + 1);
    if (!search && /read|view/.test(value) && paths.length === 1 && typeof paths[0] === 'string' &&
        targetedSource(project, cwd, paths[0]) && Number.isInteger(limit) && limit > 0 && limit <= 200) return;
    if (!paths.length || !paths.every(path => projectNote(project, input.cwd ?? cwd, path))) return search ? 'source-search' : 'source-read';
    return;
  }
  if (/^(?:agent|task|subagent|spawn_agent|worktree_create|opencode_worktree_create)$/.test(value)) return 'unclassified-tool';
}

export function appendSeniorToolEvent(log, fields) {
  appendFileSync(log, JSON.stringify({ at: Date.now(), ...fields }) + '\n', { mode: 0o600, flush: true,
    flag: constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW | constants.O_NONBLOCK });
}

export function rotationToolDenial(log, project, cwd, name, input = {}) {
  if (!log || !project) return;
  const addr = /^(?:loom|oar)-[a-f0-9-]{36}(?=\.tool-guard\.jsonl$)/.exec(basename(log))?.[0];
  if (!addr) return;
  let state;
  try { state = JSON.parse(readText(join(dirname(dirname(log)), 'rotation-v2.json'), '{}')); }
  catch { return 'Loom 无法读取交接状态。请用 loom status 核对。'; }
  const role = state.sessions?.[addr] ?? {};
  const handover = state.handovers?.[addr];
  const restricted = role.frozen || role.holding || role.checking || role.retired || role.highWater;
  const command = input?.command ?? input?.cmd ?? input?.CommandLine;
  const nameLower = name?.toLowerCase() ?? '';
  const commandText = Array.isArray(command) ? command[2] : command;
  const raw = typeof commandText === 'string' ? commandText : '';
  const note = join(project, '.project', 'loomd', 'rotation-notes', addr + '.md');
  const noteOnly = role.highWater && !role.frozen && !role.holding && !role.checking &&
    (nameLower === 'apply_patch' ? [...raw.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)]
      .every((match, _, paths) => paths.length && resolve(cwd, match[1]) === note) && raw.includes(note) :
      /^(write|edit)$/.test(nameLower) && resolve(cwd, input.file_path ?? input.path ?? '.') === note);
  if (restricted && !noteOnly) {
    const shell = typeof raw === 'string' && !/[\r\n!;|&<>\x60*?{}]/.test(raw) &&
      (!raw.includes('$') || /^"\$LOOM_BIN" /.test(raw) && !raw.slice(11).includes('$')) &&
      !(Array.isArray(command) && !(command.length === 3 && /^(ba|z)?sh$/.test(basename(command[0])) && /^-l?c$/.test(command[1])));
    const parts = shell && shellCommands(raw)?.[0];
    const [exe, sub, ...args] = parts ?? [];
    const loom = exe === '$LOOM_BIN' || exe === join(project, '.project', 'loomd', 'bin', 'loom');
    const query = loom && (['ls', 'state', 'status', 'hist', 'cost'].includes(sub) ||
      sub === 'notifications' && args.every(arg => ['--peek', '--history'].includes(arg)) ||
      sub === 'rotation-policy' && ['verify', 'spot-check'].includes(args[0]) ||
      role.highWater && !role.holding && !role.frozen && sub === 'rotate' && args.includes('--self'));
    const source = target => typeof target === 'string' && targetedSource(project, cwd, target) &&
      !/(?:^|\/)(?:\.env[^/]*|credentials\.json|auth\.json)(?:\/|$)/i.test(target);
    const readShell = exe && (basename(exe) === 'git' && ['status', 'rev-parse', 'log', 'show', 'diff'].includes(sub) &&
      args.every(arg => !/^--(?:output|ext-diff|textconv|no-index|exec|open-files-in-pager)/.test(arg)) ||
      ['cat', 'head', 'tail', 'wc', 'ls', 'stat'].includes(basename(exe)) &&
      [sub, ...args].filter(arg => arg && !/^(?:-n|-l|-a|\d+)$/.test(arg)).every(source));
    const readTool = /^(?:read|read_file|view_file|list_dir)$/.test(nameLower) &&
      (input?.paths ?? [input?.file_path ?? input?.filePath ?? input?.path ?? input?.Path ?? input?.TargetFile ?? input?.AbsolutePath]).every(source);
    if (!query && !readShell && !readTool) return 'Loom 当前只允许核对项目原件。写入和新决策已冻结。';
  }
  if (handover?.completedAt && new Date().toDateString() === new Date(handover.completedAt).toDateString()) {
    const policyWrite = /(?:write|edit|patch|bash|shell|exec|run_command)/.test(nameLower) &&
      (typeof raw === 'string' && raw.includes('policy.json') ||
        [input?.file_path, input?.path, ...(input?.paths ?? [])].some(path => typeof path === 'string' && path.endsWith('policy.json')));
    if (policyWrite && !['merge', 'concurrency', 'budget'].every(kind => role.confirmations?.[kind])) {
      return '新任当日修改项目策略文件须取得合入、并发与预算口径确认。';
    }
    if (typeof raw === 'string' && seniorShellCategory(raw, cwd, project) === 'git-integration' && !role.confirmations?.merge) {
      return '新任当日改变合入规则须由另一方或 Super 确认。';
    }
  }
}

export function recordSeniorToolDenial(log, project, cwd, name, input) {
  if (!log || !project) return;
  const restriction = rotationToolDenial(log, project, cwd ?? project, name, input);
  if (restriction) return restriction;
  const category = seniorToolCategory(name, input, cwd ?? project, project);
  if (!category) return;
  const raw = input?.command ?? input?.cmd ?? input?.CommandLine;
  const command = typeof raw === 'string' ? raw :
    Array.isArray(raw) && raw.length === 3 && typeof raw[0] === 'string' &&
    /^(?:ba|z)?sh$/.test(basename(raw[0])) && /^-l?c$/.test(raw[1]) ? raw[2] : undefined;
  const requestedCwd = input?.workdir ?? input?.cwd ?? '.';
  const effectiveCwd = typeof requestedCwd === 'string' ? resolve(cwd ?? project, requestedCwd) : undefined;
  const retryable = /^(?:bash|shell|exec_command|run_command|terminal)$/i.test(name ?? '') &&
    typeof command === 'string' && command.trim() && command.length <= 16_000 &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(command) && effectiveCwd && within(project, effectiveCwd);
  const denyId = retryable ? randomUUID() : undefined;
  const [cause, alternative] = denialSpecs[category] ?? denialSpecs['unclassified-tool'];
  const fallback = `禁止：${cause}；改为：${alternative}`;
  try {
    appendSeniorToolEvent(log, { type: 'senior-tool-denied', category,
      ...(denyId && { denyId, command, cwd: effectiveCwd, key: seniorCommandKey(command) }) });
  } catch { return fallback; }
  if (!denyId) return fallback;
  if (category === 'source-read') {
    return `禁止：${cause}；改为：单文件 ≤200 行读取，或 senior-tool --retry ${denyId} --file <路径> --lines <起-止> --reason "<理由>"`;
  }
  return `禁止：${cause}；改为：${alternative}（ID ${denyId}）`;
}
