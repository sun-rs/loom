import { randomUUID } from 'node:crypto';
import { appendFileSync, constants, existsSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { readText } from '../daemon/io.mjs';

import { seniorCommandKey } from './senior-command.mjs';

const delegateTool = '建议派 worker 卡。';
const within = (root, path) => {
  const part = relative(root, path);
  return !isAbsolute(part) && part !== '..' && !part.startsWith('../');
};

function projectNote(project, cwd, value) {
  if (typeof value === 'string' && value.startsWith('$LOOM_PROJECT/')) value = join(project, value.slice(14));
  if (typeof value !== 'string' || !value || /[$`*?\[\]{}]/.test(value)) return false;
  const root = join(project, '.project');
  let path = resolve(cwd, value);
  if (!within(root, path)) return false;
  try {
    while (!existsSync(path) && path !== root) path = dirname(path);
    return within(root, realpathSync(path));
  } catch { return false; }
}

function targetedSource(project, cwd, value) {
  if (typeof value !== 'string' || !value || /[$`*?\[\]{}]/.test(value)) return false;
  const path = resolve(cwd, value);
  if (!within(project, path)) return false;
  try { return within(project, realpathSync(path)); }
  catch { return false; }
}

const shellWords = /'(?:[^']*)'|"(?:\\.|[^"\\])*"|\\.|&&|\|\||>>|[\s;|&<>]|[^\s'";|&<>\\]+/gy;
export function shellCommands(text) {
  const commands = [[]];
  let word = '';
  let started = false;
  let end = 0;
  for (const { 0: token, index } of text.matchAll(shellWords)) {
    if (/^(?:[\t\r ]|\n|&&|\|\||[;|&<>]|>>)$/.test(token)) {
      if (started) commands.at(-1).push(word);
      started = false;
      word = '';
      if (/^[\n;&|]/.test(token)) commands.push([]);
      if (/^[<>]/.test(token)) commands.at(-1).push(token);
    } else if (token !== '\\\n') {
      started = true;
      word += /^["']/.test(token) ? token.slice(1, -1) : token.replace(/^\\/, '');
    }
    end = index + token.length;
  }
  if (end !== text.length) return;
  if (started) commands.at(-1).push(word);
  return commands.filter(command => command.length);
}

export function seniorShellCategory(command, cwd, project) {
  if (typeof command !== 'string') return 'unclassified-tool';
  const text = command.replace(/\\\n/g, ' ');
  if (/\b(?:while|until|for)\b[^\n]*(?:\n|;|\bdo\b)[\s\S]*\b(?:loom|LOOM_BIN)["']?\s+state\b/.test(text)) return 'state-poll';
  const commands = shellCommands(text.replace(/\b[12]>&[12]\b/g, ''));
  if (!commands?.length) return 'unclassified-tool';
  const first = commands[0].filter(word => !word.startsWith('LOOM_SENIOR_OVERRIDE='));
  if (commands.length === 1 && first[1] === 'senior-tool' &&
      (first[0] === '$LOOM_BIN' || first[0] === join(project, '.project', 'loomd', 'bin', 'loom')) &&
      !/\$\(|`|[<>]\(/.test(text.replace(/'[^']*'/g, ''))) return;
  if (/\$\(|`|[<>]\(|\$\{/.test(text)) return 'unclassified-tool';
  for (const words of commands) {
    const args = [...words];
    while (/^[A-Za-z_][\w]*=/.test(args[0] ?? '')) args.shift();
    if (!args.length) continue;
    const executable = args.shift();
    const name = basename(executable);
    if (['env', 'command', 'exec', 'time', 'timeout', 'nice'].includes(name)) return 'unclassified-tool';
    const redirects = args.flatMap((word, i) => ['<', '>', '>>'].includes(word) ? [args[i + 1]] : []);
    if (redirects.some(path => path !== '/dev/null' && !projectNote(project, cwd, path))) return 'source-read';
    const redirect = args.findIndex(word => ['<', '>', '>>'].includes(word));
    if (redirect >= 0) args.length = redirect;
    if (/^(npm|npx|pnpm|yarn|bun|pytest|cargo|go|make|gmake|cmake|ninja|ctest|mvn|gradle|swift|xcodebuild|uv|tox|jest|vitest|tsc|ruff)$/.test(name) ||
        ['node', 'deno', 'python', 'python3', 'ruby'].includes(name) && args.some(arg => /(?:^--test(?:$|[=-])|pytest|(?:^|\.)test\.|\b(?:tests?|probe)[-/])/i.test(arg))) {
      return 'test-build';
    }
    if (name === 'git') {
      while (['-C', '--no-pager', '--no-optional-locks', '--no-replace-objects'].includes(args[0])) {
        args.splice(0, args[0] === '-C' ? 2 : 1);
      }
      const sub = args.shift();
      if (['merge', 'rebase', 'cherry-pick'].includes(sub) || sub === 'worktree' && args[0] === 'add') return 'git-integration';
      if (['diff', 'show'].includes(sub) && !args.some(arg => /^(?:--(?:stat|shortstat|numstat)(?:=|$)|--no-patch$|-s$)/.test(arg))) return 'source-read';
      if (args.some(arg => /^(?:-p(?:$|[0-9])|--(?:patch|stat-with-patch|ext-diff|textconv|output)(?:=|$))/.test(arg)) ||
          !['diff', 'show', 'log', 'rev-parse', 'status', 'merge-base', 'branch', 'worktree'].includes(sub) ||
          sub === 'branch' && !args.every(arg => arg.startsWith('--show-current') || arg === '--list') ||
          sub === 'worktree' && args[0] !== 'list') return 'unclassified-tool';
      continue;
    }
    if (executable === '$LOOM_BIN' || executable === join(project, '.project', 'loomd', 'bin', 'loom') || executable === 'loom') continue;
    if (['pwd', 'true', 'false', ':', 'echo', 'printf'].includes(name)) continue;
    if (name === 'cd' && args.length === 1 && !/[$`*?\[\]{}]/.test(args[0]) && within(project, resolve(cwd, args[0]))) {
      cwd = resolve(cwd, args[0]);
      continue;
    }
    if (['rg', 'grep', 'egrep', 'find', 'fd'].includes(name)) {
      const paths = name === 'find' ? args.slice(0, 1) : args.filter(arg => !arg.startsWith('-')).slice(1);
      if (!paths.length || !paths.every(path => projectNote(project, cwd, path)) ||
          args.some(arg => /^(?:--pre|--follow|-L|-exec|-ok|-delete)/.test(arg))) return 'source-search';
      continue;
    }
    if (name === 'sed' && args.length === 3 && args[0] === '-n') {
      const range = /^(\d+)(?:,(\d+))?p$/.exec(args[1]);
      if (range && Number(range[2] ?? range[1]) >= Number(range[1]) &&
          Number(range[2] ?? range[1]) - Number(range[1]) + 1 <= 200 && targetedSource(project, cwd, args[2])) continue;
    }
    if (['head', 'tail'].includes(name) && args.length === 3 && args[0] === '-n' &&
        /^\d+$/.test(args[1]) && Number(args[1]) <= 200 && targetedSource(project, cwd, args[2])) continue;
    if (['cat', 'head', 'tail', 'wc', 'ls', 'stat', 'shasum', 'sha256sum'].includes(name)) {
      const paths = args.filter(arg => !arg.startsWith('-') && !/^\d+$/.test(arg) && arg !== '/dev/null');
      if (paths.every(arg => projectNote(project, cwd, arg)) && (paths.length || !['ls', 'stat'].includes(name))) continue;
      return 'source-read';
    }
    return 'unclassified-tool';
  }
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
  try {
    appendSeniorToolEvent(log, { type: 'senior-tool-denied', category,
      ...(denyId && { denyId, command, cwd: effectiveCwd, key: seniorCommandKey(command) }) });
  } catch { return delegateTool; }
  if (!denyId) return delegateTool;
  return `${delegateTool}确有必要时，带理由重试。请把示例理由换成实际原因。\n` +
    `"$LOOM_BIN" senior-tool --retry ${denyId} --reason "需要核对本轮候选的验证结果"`;
}
