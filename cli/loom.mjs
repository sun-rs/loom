import { parseArgs } from 'node:util';
import { memoryCommand } from './memory.mjs';
import { roles } from '../index/index.mjs';
import { daemonAbsent, request } from '../daemon/rpc.mjs';
import { control, daemonUsage, grantUsage, spawnHelp, spawnUsage, startDaemon, workerGrant } from './control.mjs';
import { upgrade, upgradePendingExit, upgradeUsage } from './upgrade.mjs';
import { history, historyReader, waveHistory } from './history.mjs';
import { callerAddress, managedProject, projectDirectory, projectIndex, projectOption, projectReceipt, projectSessions } from './project.mjs';
import { send, sendAdvancedHelp, sendHelp, sendUsage } from './send.mjs';
import { CommandError, predecessors, readState, resolveTarget } from './sessions.mjs';
import { presentState } from './state.mjs';
import { withTuiVersionWarnings } from './tui-version.mjs';
import { pendingWork } from '../inbox/engine.mjs';
import { readText } from '../daemon/io.mjs';
import { readNotifications } from '../daemon/notifications.mjs';
import { indexLine, searchMemory } from '../memory/project.mjs';
import { join } from 'node:path';
import { runSeniorTool, seniorToolUsage } from './senior-tool.mjs';

const strings = (...keys) => Object.fromEntries(keys.map(key => [key, { type: 'string' }]));
const flags = (...keys) => Object.fromEntries(keys.map(key => [key, { type: 'boolean' }]));
const projectArgs = strings('project');
const help = {
  'senior-tool': [seniorToolUsage],
  lint: ['loom lint [--project DIR] [--json]'],
  'audit-findings': ['loom audit-findings <phase> [--project DIR]',
    'loom audit-findings <phase> --id ID --category CATEGORY --evidence TEXT',
    'loom audit-findings <phase> --id ID --regression PROJECT_RELATIVE_PATH'],
  hist: [
    'loom hist <role|task|addr> [--project DIR] [--turn N | --turns N] [--level L1|L2] [--json]',
    'loom hist --role ROLE [--project DIR] [--since ISO-TIME|N|turn:ADDR#N] [--turn N | --turns N] [--level L1|L2] [--json]',
    'loom hist --wave W [--project DIR] [--diff] [--evidence] [--json]',
    'loom hist --grep KW [--project DIR] [--turns N] [--level L1|L2] [--json]',
    'History paging: [--before N|turn:ADDR#N] [--page N] or [--all] for L1 summaries. Page 1 is the newest.',
    'Turn filters: [--outcome failed|aborted|quota|blocked|unverified|recovered] [--diff] [--evidence]',
    'L2 tool filters: [--tool shell|edit|read|other] [--cmd REGEX] [--tail N] [--only-failed] [--with-calls]',
  ],
  state: ['loom state <target> [--project DIR]'],
  memory: ['loom memory search <query> [--project DIR] [--json]'],
  mem: [
    'loom mem search <query> [--project DIR] [--json]',
    'loom mem show <id> [--project DIR] [--json]',
    'loom mem write --entry <json> --request-id <id> --expected-revision null [--project DIR] [--json]',
    'loom mem update <id> --entry <json> --request-id <id> --expected-revision <revision> [--project DIR] [--json]',
    'loom mem invalidate <id> --request-id <id> --expected-revision <revision> [--project DIR] [--json]',
    'loom mem proposals list [--project DIR] [--json]',
    'loom mem proposals approve <id> [--project DIR] [--json]',
    'loom mem proposals reject <id> [--reason TEXT] [--project DIR] [--json]',
  ],
  status: ['loom status --project DIR [--json]'],
  accounts: ['loom accounts [--project DIR] [--json] [--refresh]'],
  up: [
    'loom up [--resume | --fresh] [--cli CLI] [--model MODEL] [--effort EFFORT] [--entry PATH] [--account-dir DIR] [--cwd DIR] [--timeout-ms N] [--json]',
    'Starts or resumes Super in the global "Loom" space. Legacy: loom up --project DIR (use loom project up DIR).',
  ],
  project: ['loom project up [DIR] [--project DIR]'],
  recover: ['loom recover [--project DIR | --all-projects] [--json]'],
  resume: ['loom resume <addr> [--project DIR] [--cli CLI] [--model MODEL] [--account-dir DIR] [--entry PATH] [--timeout-ms N] [--json]'],
  tui: ['loom tui [--project DIR | --all] [--once]'],
  layout: [
    'loom layout get <leader|auditor|status> [--project DIR] [--json]',
    'loom layout adopt --project DIR --leader HC_ADDRESS --auditor HC_ADDRESS',
  ],
  super: ['loom super --terminal HC_ADDRESS [--project DIR]', 'loom super --close [--reason TEXT]'],
  cost: ['loom cost [--project DIR]', 'Reports role usage, rotation briefing tokens, the rolling consumption pyramid, estimated USD costs, session-tree RSS and per-turn acceptance timing.'],
  gate: ['loom gate pack <gate-id> [--round N] [--reuse] [--project DIR] [--base REF] [--candidate REF] [--question TEXT]'],
  escalate: ['loom escalate <gate-id> --reason REASON --evidence TEXT [--round N] [--project DIR] [--base REF] [--candidate REF]',
    'Leader only. Reasons: protected-file, assertion, skip-only, confirmed-fact-miss, sandbox-escape.'],
  stop: ['loom stop <target> [--project DIR]'],
  send: [sendUsage, sendHelp],
  handover: ['loom handover <leader|auditor|super> --project DIR [--to ADDR]'],
  spawn: [spawnUsage, spawnHelp],
  assign: ['loom assign --resume-attempt <task|addr> [--reason TEXT] [--project DIR]'],
  keep: ['loom keep <task|addr> [--clear] [--project DIR]'],
  release: ['loom release <task|addr> [--project DIR]'],
  'worker-check': ['loom worker-check [--project DIR]'],
  'worker-handoff': ['loom worker-handoff --wip TEXT --passed TEXT --pending TEXT [--project DIR]',
    'loom worker-handoff <task|addr> [--reason no-progress | --reason fabrication|overreach --evidence TEXT] [--project DIR]'],
  grant: [grantUsage, 'A Leader can use --request to ask Super for a host grant. --unconfined (Super only) disables Loom outer Seatbelt for all CLIs.'],
  rotate: ['loom rotate --self [--prepare | --reason R] [--project DIR]',
    'loom rotate --target <leader|auditor|ADDR> [--prepare | --reason R] [--cli CLI] [--model MODEL] [--effort EFFORT] [--passive] [--project DIR] (Super)'],
  'rotation-policy': ['loom rotation-policy <scope|ruling|correction|profile|error|incident|spot-check|audit|constraint|verify-note|verify|verify-decision|abort|rule-change> [--project DIR]',
    'Scope uses --phase or --goal. Records use --target, --detail and --evidence FILE[:LINE] where required. See docs/ORG.md for actions and verdicts.'],
  switch: ['loom switch <leader|auditor|worker> --project DIR --to <1-based index|cli/model/effort[/fast]>'],
  daemon: [daemonUsage],
  upgrade: [upgradeUsage],
  ls: ['loom ls [--project DIR]'],
  doctor: ['loom doctor --project DIR [--fix | --prompts]', 'Reports project-owned residue. --prompts checks local CLI versions and prompt handling in an isolated test.'],
  notifications: [
    'loom notifications [--project DIR] [--peek|--take|--history]',
    'loom notifications [--project DIR] --needs-decision TEXT [--kind decision | --audit-escalation REASON]',
    'loom notifications [--project DIR] --complete TEXT [--phase ID]',
    'loom notifications [--project DIR] --gate-complete ID [--candidate SHA]',
    'Previews pending events by default. --take acknowledges them. --history includes acknowledged events.',
  ],
};
const commands = {
  hist: { ...strings('turn', 'turns', 'level', 'role', 'project', 'since', 'before', 'page', 'outcome', 'wave', 'grep', 'tool', 'cmd', 'tail'),
    ...flags('json', 'diff', 'evidence', 'only-failed', 'with-calls', 'all') },
  lint: { ...projectArgs, ...flags('json') },
  'audit-findings': { ...projectArgs, ...strings('id', 'category', 'evidence', 'regression') },
  state: projectArgs, stop: projectArgs, ls: projectArgs, cost: projectArgs,
  assign: { ...projectArgs, ...flags('resume-attempt'), ...strings('reason') },
  keep: { ...projectArgs, ...flags('clear') },
  release: projectArgs,
  'worker-check': projectArgs,
  'worker-handoff': { ...projectArgs, ...strings('wip', 'passed', 'pending', 'reason', 'evidence') },
  status: { ...projectArgs, ...flags('json') },
  accounts: { ...projectArgs, ...flags('json', 'refresh') },
  up: { ...projectArgs, ...flags('resume', 'fresh', 'json'), ...strings('cli', 'model', 'effort', 'entry', 'account-dir', 'cwd', 'timeout-ms', 'cli-version') },
  project: projectArgs,
  recover: { ...projectArgs, ...flags('all-projects', 'json') },
  resume: { ...projectArgs, ...strings('cli', 'model', 'account-dir', 'entry', 'timeout-ms', 'cli-version'), ...flags('json') },
  tui: { ...projectArgs, ...flags('all', 'once') },
  layout: { ...projectArgs, ...strings('leader', 'auditor'), ...flags('json') },
  super: { ...projectArgs, ...strings('terminal', 'reason'), ...flags('close') },
  gate: { ...projectArgs, ...strings('base', 'candidate', 'question', 'round'), ...flags('reuse') },
  escalate: { ...projectArgs, ...strings('base', 'candidate', 'reason', 'evidence', 'round') },
  memory: { ...projectArgs, ...flags('json') },
  mem: { ...projectArgs, ...strings('entry', 'request-id', 'expected-revision', 'reason'), ...flags('json') },
  'rotation-policy': { ...projectArgs, ...strings('target', 'id', 'detail', 'evidence', 'verdict', 'phase', 'goal', 'version', 'supersedes') },
  switch: { ...projectArgs, ...strings('to') },
  rotate: { ...projectArgs, ...flags('self', 'prepare', 'passive'), ...strings('target', 'reason', 'cli', 'model', 'effort') },
  doctor: { ...projectArgs, ...flags('fix', 'prompts') },
  notifications: { ...projectArgs, ...flags('peek', 'take', 'history'),
    ...strings('needs-decision', 'kind', 'audit-escalation', 'complete', 'phase', 'gate-complete', 'candidate') },
};

function readPendingWork(project, addr) {
  const { messages } = JSON.parse(readText(join(project, '.project', 'inbox', 'state.json'), '{"messages":[]}'));
  const ended = new Set(messages.length ? projectSessions(project).filter(row => row.endedAt != null).map(row => row.addr) : []);
  return pendingWork(messages, addr, undefined, target => ended.has(target));
}

function invalid(message) {
  throw new CommandError('invalid-arguments', message);
}

function positiveNumber(value) {
  const number = Number(value);
  if (/^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0) return number;
}

function turnCursor(value) {
  const index = positiveNumber(value.replace(/^turn:/, ''));
  if (index !== undefined) return { index };
  const cursor = /^turn:([^#]+)#(\d+)$/.exec(value);
  if (cursor && positiveNumber(cursor[2]) !== undefined) return { addr: cursor[1], index: Number(cursor[2]) };
}

function sinceValue(value) {
  const cursor = turnCursor(value);
  if (cursor) return cursor;
  const date = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
  if (date.test(value)) {
    const at = Date.parse(value);
    if (Number.isFinite(at)) return { at };
  }
  invalid('Expected an ISO time, a positive turn number or turn:ADDR#N for --since');
}

function printHistory(result) {
  if (result.waves) {
    for (const wave of result.waves) console.log(JSON.stringify(wave, null, 2));
    return;
  }
  console.log(`${result.addr ?? result.role ?? result.projectId} ${result.level}`);
  if (!result.turns.length) console.log('暂无轮次');
  for (const turn of result.turns) {
    if (result.level === 'L2') console.log(JSON.stringify(turn, null, 2));
    else {
      const label = turn.addr ? `第 ${turn.timelineIndex} 轮 · ${turn.addr}#${turn.index}\n` : '';
      console.log(`\n${label}${turn.summary}`);
      for (const event of turn.seniorTools ?? []) console.log([event.type, event.category, event.reason].filter(Boolean).join(' · '));
      if (turn.diff) console.log(JSON.stringify(turn.diff, null, 2));
      for (const card of turn.evidence ?? []) console.log(`${card.path}\n${card.summary ?? ''}`);
    }
  }
  if (result.pagination?.nextBefore) console.log(`\n更早轮次 · --before ${result.pagination.nextBefore}`);
  for (const gap of result.missing ?? []) console.log(`\n${gap.addr} · ${gap.message}`);
}

async function hist(values, positionals, directory) {
  const { role, wave, outcome, tool, grep, all } = values;
  const onlyFailed = values['only-failed'];
  const withCalls = values['with-calls'];
  const toolFilters = tool || values.cmd !== undefined || values.tail !== undefined || onlyFailed || withCalls;
  const level = values.level ?? (toolFilters ? 'L2' : 'L1');
  if (!['L1', 'L2'].includes(level)) invalid('Expected L1 or L2 for --level');
  if (outcome !== undefined && !['failed', 'aborted', 'quota', 'blocked', 'unverified', 'recovered'].includes(outcome)) invalid('Invalid --outcome');
  if (tool !== undefined && !['shell', 'edit', 'read', 'other'].includes(tool)) invalid('Expected shell, edit, read or other for --tool');
  if (level === 'L1' && toolFilters) invalid('Tool filters require L2');
  for (const key of ['turn', 'turns', 'tail', 'page']) {
    if (values[key] !== undefined && positiveNumber(values[key]) === undefined) invalid(`Expected a positive integer for --${key}`);
  }
  const before = values.before === undefined ? undefined : turnCursor(values.before);
  if (values.before !== undefined && !before) invalid('Expected a positive turn number or turn:ADDR#N for --before');
  const page = positiveNumber(values.page);
  if (values.turn !== undefined && (values.turns !== undefined || values.since !== undefined || before || page || all)) {
    invalid('--turn selects a single turn. Use it without range or page options.');
  }
  if (all && (level !== 'L1' || page || values.turns !== undefined)) {
    invalid('--all shows L1 summaries without a page size or page number.');
  }
  if (grep !== undefined && !grep.trim()) invalid('Expected a keyword for --grep');
  if (positionals.length > 1 || positionals.some(target => !target.trim()) ||
      role !== undefined && (!roles.includes(role) || positionals.length > 0) ||
      values.since !== undefined && !role) invalid('Expected one history target or --role ROLE');
  let command;
  if (values.cmd !== undefined) {
    try { command = new RegExp(values.cmd); } catch (error) { invalid(error.message); }
  }
  const scope = Boolean(values.project !== undefined || process.env.LOOM_PROJECT || role || wave || grep);
  const sessions = projectSessions(directory, scope);
  const reader = historyReader(directory);
  const showDiff = Boolean(values.diff);
  const evidence = Boolean(values.evidence);
  const output = { ok: true, ...projectReceipt(directory) };
  if (wave !== undefined) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(wave) ||
        Object.keys(values).some(key => !['wave', 'project', 'diff', 'evidence', 'json'].includes(key)) || positionals.length) {
      invalid('--wave accepts only --project, --diff, --evidence and --json');
    }
    return { ...output, wave, waves: await waveHistory(sessions, reader, directory, wave, { showDiff, evidence }) };
  }
  const since = values.since === undefined ? undefined : sinceValue(values.since);
  const exact = positiveNumber(values.turn);
  const defaultCount = level === 'L2' ? 1 : 5;
  const count = all ? Infinity : positiveNumber(values.turns) ??
    (!before && !page && (outcome || grep || since) ? Infinity : defaultCount);
  const options = { level, count, since, before, page, exact, outcome, grep: grep?.toLowerCase(), tool, command,
    tail: positiveNumber(values.tail) ?? 20, showDiff, evidence, onlyFailed, withCalls,
    latestSettled: level === 'L2' && !all && !before && !page && values.turns === undefined &&
      !exact && !since && !outcome && !grep && !toolFilters };
  if (role || grep && !positionals.length) {
    const matches = role ? sessions.filter(row => row.role === role) : sessions;
    if (role && !matches.length) throw new CommandError('not-found', `No ${role} sessions in ${directory}`);
    return { ...output, ...(role && { role }), level, ...await history(matches, reader, { ...options, timeline: true }) };
  }
  if (!positionals.length) invalid('Expected a history target, --role, --wave or --grep');
  const session = resolveTarget(sessions, positionals[0], callerAddress());
  const chain = exact ? [session] : predecessors(session, sessions);
  return { ...output, addr: session.addr, level, ...await history(chain, reader,
    { ...options, exactAddr: exact ? session.addr : undefined, timeline: chain.length > 1 }) };
}

function parse(command, args) {
  try {
    return parseArgs({ args, options: commands[command], allowPositionals: true });
  } catch (error) {
    if (command === 'mem') invalid('Invalid loom mem arguments. See loom mem --help.');
    invalid(error.message);
  }
}

const emit = value => console.log(JSON.stringify(value));
const errorExit = code => code === 'invalid-arguments' ? 2 : ['not-found', 'ambiguous-target'].includes(code) ? 3 : 1;

export async function main(args) {
  const [command, ...rest] = args;
  if (!command || args.length === 1 && ['--help', '-h'].includes(command)) {
    console.log([...Object.values(help).flat(), projectOption,
      'External Super uses LOOM_EXTERNAL_SUPER=1 from a local operator shell.'].join('\n'));
    return 0;
  }
  try {
    if (!Object.hasOwn(help, command)) invalid(`Unknown command: ${command}`);
    if (rest.length === 1 && ['--help', '-h'].includes(rest[0])) {
      console.log([...help[command], projectOption].join('\n'));
      return 0;
    }
    if (command === 'send') {
      if (rest.length === 1 && rest[0] === '--help-advanced') {
        console.log([sendUsage, sendHelp, sendAdvancedHelp, projectOption].join('\n'));
        return 0;
      }
      const result = await send(rest);
      emit(result);
      return result.ok ? 0 : errorExit(result.error.code);
    }
    if (command === 'spawn' || command === 'daemon') {
      const result = await control(command, rest);
      if (result) emit(result);
      return 0;
    }
    if (command === 'grant') {
      emit(await workerGrant(rest));
      return 0;
    }
    if (command === 'upgrade') {
      const result = await upgrade(rest);
      emit(result);
      return result.ok ? 0 : result.pending ? upgradePendingExit : 1;
    }
    if (command === 'handover') {
      const { main: handover, queueBrief } = await import('../handover/cli.mjs');
      return await handover(rest, {
        indexFor(_requested, directory) {
          const rows = projectSessions(directory);
          // The handover reader expects one internal project key even for
          // old local databases that stored nicknames.
          return { index: { query: () => rows.map(row => ({ ...row, project: directory })) }, project: directory };
        },
        async queue({ projectDir, from, to, brief }) {
          if (!managedProject(projectDir)) return queueBrief({ projectDir, to, brief });
          try { return await request(projectDir, 'handover', { target: to, from, text: brief }); }
          catch (error) {
            if (!daemonAbsent(error)) throw error;
            throw new CommandError('not-ready', 'loomd must be running to hand over in-flight work');
          }
        },
        projectDirectory,
        locate: false,
        emit(result) {
          if (result.project) emit({ ...result, ...projectReceipt(result.project) });
          else emit(result);
        },
      });
    }
    if (['up', 'project', 'recover', 'resume', 'tui', 'layout', 'super'].includes(command)) {
      const { values, positionals } = parse(command, rest);
      if (command === 'tui') {
        if (positionals.length || values.all && values.project !== undefined) invalid(help.tui[0]);
        const { statusTui } = await import('./status-tui.mjs');
        return await statusTui({ project: values.all ? undefined : projectDirectory(values.project), once: values.once });
      }
      async function runProjectUp(project) {
        await startDaemon(project);
        const { registerGlobalProject } = await import('../daemon/global-registry.mjs');
        const { releaseId } = await import('../daemon/release.mjs');
        try { registerGlobalProject(project, { release: releaseId(), lastOnlineAt: Date.now(), lastShutdown: 'abnormal' }); }
        catch { /* Global registry updates are best-effort if LOOM_GLOBAL_DIR is unwritable. */ }
        try {
          return { ...await request(project, 'layout-up'), ...projectReceipt(project) };
        } catch (error) {
          if (error.code === 'herdr-disabled') {
            return { ok: true, layout: null, layoutSkipped: 'herdr-disabled', ...projectReceipt(project) };
          }
          throw error;
        }
      }
      if (command === 'project') {
        const [action, dir] = positionals;
        if (action !== 'up' || positionals.length > 2 || dir && values.project !== undefined) invalid(help.project[0]);
        emit(await runProjectUp(projectDirectory(dir ?? values.project)));
        return 0;
      }
      if (command === 'up') {
        if (values.project !== undefined) {
          if (positionals.length) invalid(help.up[0]);
          console.error('loom up --project DIR 已更名为 loom project up DIR，请改用新命令。');
          const res = await runProjectUp(projectDirectory(values.project));
          emit({ ...res, deprecated: 'Use loom project up DIR' });
          return 0;
        }
        if (positionals.length) invalid(help.up[0]);
        const timeoutMs = values['timeout-ms'] === undefined ? undefined : positiveNumber(values['timeout-ms']);
        if (values['timeout-ms'] !== undefined && timeoutMs === undefined) invalid('Expected a positive integer for --timeout-ms');
        const { formatSuperChooseText, superUp } = await import('../daemon/super-up.mjs');
        const result = await superUp({
          resume: values.resume, fresh: values.fresh, cli: values.cli, model: values.model, effort: values.effort,
          entry: values.entry, accountDir: values['account-dir'], cwd: values.cwd, cliVersion: values['cli-version'],
          ...(timeoutMs !== undefined && { readyTimeoutMs: timeoutMs }),
        });
        if (result.action === 'choose' && !values.json) console.log(formatSuperChooseText(result));
        else emit(result);
        return 0;
      }
      if (command === 'recover') {
        if (positionals.length || values['all-projects'] && values.project !== undefined) invalid(help.recover[0]);
        const { formatRecoverText, recoverAllProjects, recoverProject, requireSuperCaller } = await import('../daemon/recover.mjs');
        const scope = values['all-projects'] ? undefined : projectDirectory(values.project);
        requireSuperCaller(process.env, scope);
        let result;
        if (values['all-projects']) {
          result = await recoverAllProjects();
        } else {
          try { result = { ok: true, ...await request(scope, 'recover') }; }
          catch (error) {
            if (!daemonAbsent(error)) throw error;
            result = { ok: true, ...await recoverProject(scope) };
          }
        }
        if (values.json) emit(result);
        else console.log(formatRecoverText(result));
        return 0;
      }
      if (command === 'resume') {
        const [target] = positionals;
        if (positionals.length !== 1 || !target.trim()) invalid(help.resume[0]);
        const timeoutMs = values['timeout-ms'] === undefined ? undefined : positiveNumber(values['timeout-ms']);
        if (values['timeout-ms'] !== undefined && timeoutMs === undefined) invalid('Expected a positive integer for --timeout-ms');
        const project = projectDirectory(values.project);
        const { resolveAccountDir } = await import('../daemon/global-registry.mjs');
        const accountDirs = {
          codex: resolveAccountDir('codex'), agy: resolveAccountDir('agy'),
          claude: resolveAccountDir('claude'), opencode: resolveAccountDir('opencode'),
        };
        try {
          const result = await request(project, 'resume', {
            target, cli: values.cli, model: values.model, accountDir: values['account-dir'], accountDirs,
            entry: values.entry, cliVersion: values['cli-version'], ...(timeoutMs !== undefined && { timeoutMs }),
          });
          emit({ ...result, ...projectReceipt(project) });
          return 0;
        } catch (error) {
          if (daemonAbsent(error)) {
            throw new CommandError('not-ready', `loomd is not running for this project. Run loom project up ${project} first.`);
          }
          throw error;
        }
      }
      if (command === 'super' && values.close) {
        if (positionals.length || values.terminal !== undefined) invalid(help.super[1]);
        const { superClose } = await import('../daemon/super-up.mjs');
        emit(superClose({ reason: values.reason ?? 'normal' }));
        return 0;
      }
      const project = projectDirectory(values.project);
      const { readLayout, superLayout, visibleRoles } = await import('../daemon/herdr-layout.mjs');
      if (command === 'super') {
        if (positionals.length || !/^t[0-9a-z]+$/.test(values.terminal ?? '')) invalid(help.super[0]);
        emit({ ok: true, layout: await superLayout(project, values.terminal) });
      } else if (positionals[0] === 'get') {
        const role = positionals[1];
        if (positionals.length !== 2 || ![...visibleRoles, 'status'].includes(role) || values.leader || values.auditor) invalid(help.layout[0]);
        const tab = readLayout(project)?.tabs[role];
        if (!tab?.terminal || tab.addr && !projectIndex(project).query({ addr: tab.addr }).some(row => row.endedAt === null)) {
          throw new CommandError('not-found', `No live ${role} terminal recorded in ${project}`);
        }
        if (values.json) emit(tab);
        else console.log(tab.terminal);
      } else {
        if (positionals.length !== 1 || positionals[0] !== 'adopt' || values.json ||
            !visibleRoles.every(role => /^t[0-9a-z]+$/.test(values[role] ?? ''))) invalid(help.layout[1]);
        emit(await request(project, 'layout-adopt', { leader: values.leader, auditor: values.auditor }));
      }
      return 0;
    }
    if (command === 'senior-tool') return await runSeniorTool(rest);
    const { values, positionals } = parse(command, rest);
    if (command === 'doctor' && ((!values.prompts && values.project === undefined) || values.prompts && values.fix)) invalid(help.doctor[0]);
    if (command === 'mem') {
      let directory;
      try { directory = projectDirectory(values.project); }
      catch { invalid('Expected an accessible absolute project directory'); }
      emit(await memoryCommand(directory, positionals, values));
      return 0;
    }
    const directory = projectDirectory(values.project);
    let result;
    if (command === 'lint') {
      if (positionals.length) invalid(help.lint[0]);
      const { lintProject, lintDiagnostic } = await import('../lint/project.mjs');
      const lint = lintProject(directory);
      if (values.json) emit(lint);
      else if (lint.ok) console.log(`Loom lint passed (${lint.files} files).`);
      else console.error(lint.violations.map(lintDiagnostic).join('\n'));
      return lint.ok ? 0 : 1;
    } else if (command === 'audit-findings') {
      const [phase] = positionals;
      if (positionals.length !== 1) invalid(help[command][0]);
      const { id, category, evidence, regression } = values;
      try { result = await request(directory, command, { phase, id, category, evidence, regression }); }
      catch (error) {
        if (!daemonAbsent(error)) throw error;
        if ([id, category, evidence, regression].some(value => value !== undefined)) {
          throw new CommandError('not-ready', 'loomd must be running to record an audit finding');
        }
        const { summarizeAuditFindings } = await import('../daemon/audit-findings.mjs');
        result = { ok: true, ...summarizeAuditFindings(readNotifications(directory), phase) };
      }
    } else if (command === 'rotate') {
      if (positionals.length || values.prepare && values.reason !== undefined ||
          Boolean(values.self) === Boolean(values.target) || values.self && values.passive) invalid(help.rotate[0]);
      result = await request(directory, 'rotate', values);
    } else if (command === 'rotation-policy') {
      if (positionals.length !== 1) invalid(help['rotation-policy'][0]);
      result = await request(directory, 'rotation-policy', { ...values, action: positionals[0] });
    } else if (command === 'memory') {
      const [action, query] = positionals;
      if (positionals.length !== 2 || action !== 'search' || !query.trim()) invalid(help.memory[0]);
      const matches = searchMemory(directory, query);
      if (values.json) emit(matches);
      else if (matches.length) console.log(matches.map(indexLine).join('\n'));
      return 0;
    } else if (command === 'gate' || command === 'escalate') {
      const escalate = command === 'escalate';
      const gate = positionals[escalate ? 0 : 1];
      const round = positiveNumber(values.round);
      if (escalate ? positionals.length !== 1 || !values.reason || !values.evidence :
        positionals.length !== 2 || positionals[0] !== 'pack') invalid(help[command][0]);
      if (values.round !== undefined && round === undefined || values.reuse &&
          [values.base, values.candidate, values.question].some(value => value !== undefined)) invalid(help[command][0]);
      try { result = await request(directory, escalate ? 'escalate' : 'gate-pack', {
        gate, base: values.base, candidate: values.candidate, question: values.question, reason: values.reason,
        evidence: values.evidence, round, reuse: values.reuse,
      }); }
      catch (error) {
        if (!daemonAbsent(error)) throw error;
        throw new CommandError('not-ready', 'loomd is not running for this project');
      }
    } else if (command === 'switch') {
      const [role] = positionals;
      if (positionals.length !== 1 || !['leader', 'auditor', 'worker'].includes(role) || !values.to?.trim()) invalid(help.switch[0]);
      try { result = await request(directory, 'switch', { role, to: values.to }); }
      catch (error) {
        if (!daemonAbsent(error)) throw error;
        throw new CommandError('not-ready', 'loomd is not running for this project');
      }
      if (result.session) result = await withTuiVersionWarnings(result, result.session);
    } else if (['worker-check', 'worker-handoff'].includes(command)) {
      const [target] = positionals;
      const { wip, passed, pending, reason, evidence } = values;
      if (command === 'worker-check' ? positionals.length :
        positionals.length > 1 || !target && (reason !== undefined || evidence !== undefined ||
          ![wip, passed, pending].every(value => value?.trim()))) invalid(help[command].join('\n'));
      try { result = await request(directory, command, { target, wip, passed, pending, reason, evidence }); }
      catch (error) {
        if (!daemonAbsent(error)) throw error;
        throw new CommandError('not-ready', 'loomd is not running for this project');
      }
    } else if (['keep', 'assign', 'release'].includes(command)) {
      const [target] = positionals;
      if (positionals.length !== 1 || !target.trim() || command === 'assign' && !values['resume-attempt']) invalid(help[command][0]);
      try { result = await request(directory, command, { target, reason: values.reason, ...(command === 'keep' && { keep: !values.clear }) }); }
      catch (error) {
        if (!daemonAbsent(error)) throw error;
        throw new CommandError('not-ready', 'loomd is not running for this project');
      }
    } else if (command === 'hist') {
      result = await hist(values, positionals, directory);
      if (!values.json) { printHistory(result); return 0; }
    } else if (command === 'state' || command === 'stop') {
      if (positionals.length !== 1 || !positionals[0].trim()) invalid(`Expected one ${command} target`);
      const [target] = positionals;
      const resolveSession = () => resolveTarget(
        projectSessions(directory, values.project !== undefined || Boolean(process.env.LOOM_PROJECT)), target, callerAddress());
      let session;
      if (managedProject(directory)) {
        try {
          result = await request(directory, command, { target });
          if (command === 'state') session = projectIndex(directory).query({ addr: result.addr })[0];
        } catch (error) {
          if (!daemonAbsent(error)) throw error;
          if (command === 'stop') throw new CommandError('not-ready', 'loomd is not running for this project');
          session = resolveSession();
          result = { ok: true, addr: session.addr, state: session.endedAt === null ? 'offline' : 'exited',
            deliveries: [], ...readPendingWork(directory, session.addr) };
        }
      } else if (command === 'state') {
        session = resolveSession();
        result = { ok: true, addr: session.addr, ...await readState(session), ...readPendingWork(directory, session.addr) };
      } else {
        throw new CommandError('unsupported', 'loom stop requires a daemon-managed session');
      }
      if (command === 'state') {
        if (!session) throw new CommandError('not-ready', `No indexed session matches ${result.addr}`);
        result.rotations ??= projectIndex(directory).rotations().filter(item => item.project === session.project);
        result = await withTuiVersionWarnings(presentState(result, session, directory), session);
      }
    } else {
      if (positionals.length) invalid(help[command][0]);
      if (command === 'accounts') {
        const { formatAccountsText, runAccounts } = await import('./accounts.mjs');
        result = await runAccounts({ ...values, project: directory });
        if (!values.json) {
          console.log(formatAccountsText(result, { color: process.stdout.isTTY && !Object.hasOwn(process.env, 'NO_COLOR') }));
          return 0;
        }
      } else if (command === 'status') {
        const { projectStatus, printStatus } = await import('./status.mjs');
        result = await projectStatus(directory);
        if (!values.json) { printStatus({ ...result, ...projectReceipt(directory) }); return 0; }
      } else if (command === 'cost') {
        const { projectCost } = await import('./cost.mjs');
        const { sessionMemory } = await import('./status.mjs');
        result = { ok: true, ...projectCost(directory, projectSessions(directory)), memory: await sessionMemory(directory) };
      } else if (command === 'doctor') {
        if (values.prompts) {
          const { promptDoctor } = await import('./prompt-doctor.mjs');
          const result = await promptDoctor(directory);
          emit({ ...result, ...projectReceipt(directory) });
          return result.ok ? 0 : 1;
        }
        const { doctor } = await import('./doctor.mjs');
        result = await doctor(directory, Boolean(values.fix));
      } else if (command === 'notifications') {
        const decision = values['needs-decision'];
        const auditEscalation = values['audit-escalation'];
        const gateComplete = values['gate-complete'];
        const writes = [values.complete, decision, gateComplete].filter(value => value !== undefined).length;
        if ([values.peek, values.take, values.history].filter(Boolean).length > 1 ||
            writes > 1 || auditEscalation !== undefined && decision === undefined || values.kind !== undefined &&
            (decision === undefined || values.kind !== 'decision' || auditEscalation !== undefined) ||
            values.phase !== undefined && values.complete === undefined || values.candidate !== undefined && gateComplete === undefined ||
            (values.take || values.history) && writes) invalid(help.notifications[0]);
        try { result = await request(directory, command, { take: values.take, history: values.history,
          decision, kind: values.kind, auditEscalation, gateComplete, candidate: values.candidate, complete: values.complete, phase: values.phase }); }
        catch (error) {
          if (!daemonAbsent(error)) throw error;
          if (values.take || writes) {
            throw new CommandError('not-ready', 'loomd is not running for this project');
          }
          result = { ok: true, notifications: readNotifications(directory).filter(event => values.history || event.takenAt == null) };
        }
      } else {
        let work;
        if (managedProject(directory)) {
          try {
            const { pendingDeliveries, pendingContinuations, awaitingUser, workers } = await request(directory, 'ls');
            work = { pendingDeliveries, pendingContinuations, ...(awaitingUser?.length && { awaitingUser }), workers };
          } catch (error) { if (!daemonAbsent(error)) throw error; }
        }
        const prompts = new Map((work?.awaitingUser ?? []).map(({ addr, ...prompt }) => [addr, prompt]));
        const { workers = [], ...pending } = work ?? readPendingWork(directory);
        const workerStates = new Map(workers.map(({ addr, ...fields }) => [addr, fields]));
        result = { ok: true, ...pending,
          sessions: projectSessions(directory, values.project !== undefined || Boolean(process.env.LOOM_PROJECT)).map(row =>
            ({ ...row, ...(prompts.has(row.addr) && { state: prompts.get(row.addr).kind, userPrompt: prompts.get(row.addr) }),
              ...workerStates.get(row.addr) })) };
      }
    }
    emit({ ...result, ...projectReceipt(directory) });
    return 0;
  } catch (error) {
    const code = typeof error.code === 'string' && /^[a-z-]+$/.test(error.code) ? error.code : 'unavailable';
    emit({ ok: false, error: { code, message: error.message, ...(error.freshCommand && { freshCommand: error.freshCommand }) } });
    return errorExit(code);
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
