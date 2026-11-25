import { parseArgs } from 'node:util';
import { roles } from '../index/index.mjs';
import { daemonAbsent, request } from '../daemon/rpc.mjs';
import { control, daemonUsage, spawnHelp, spawnUsage } from './control.mjs';
import { upgrade, upgradeUsage } from './upgrade.mjs';
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

const strings = (...keys) => Object.fromEntries(keys.map(key => [key, { type: 'string' }]));
const flags = (...keys) => Object.fromEntries(keys.map(key => [key, { type: 'boolean' }]));
const projectArgs = strings('project');
const help = {
  hist: [
    'loom hist <role|task|addr> [--project DIR] [--turn N | --turns N] [--level L1|L2] [--json]',
    'loom hist --role ROLE [--project DIR] [--since ISO-TIME|N|turn:ADDR#N] [--turn N | --turns N] [--level L1|L2] [--json]',
    'loom hist --wave W [--project DIR] [--diff] [--evidence] [--json]',
    'loom hist --grep KW [--project DIR] [--turns N] [--level L1|L2] [--json]',
    'Turn filters: [--outcome failed|aborted|quota|blocked|unverified|recovered] [--diff] [--evidence]',
    'L2 tool filters: [--tool shell|edit|read|other] [--cmd REGEX] [--tail N] [--only-failed] [--with-calls]',
  ],
  state: ['loom state <target> [--project DIR]'],
  memory: ['loom memory search <query> [--project DIR] [--json]'],
  status: ['loom status --project DIR [--json]'],
  cost: ['loom cost [--project DIR]', 'Reports role usage, the rolling consumption pyramid, estimated USD costs and per-turn acceptance timing.'],
  gate: ['loom gate pack <gate-id> [--project DIR] [--base REF] [--candidate REF] [--question TEXT]'],
  stop: ['loom stop <target> [--project DIR]'],
  send: [sendUsage, sendHelp],
  handover: ['loom handover <leader|auditor|super> --project DIR [--to ADDR]'],
  spawn: [spawnUsage, spawnHelp],
  switch: ['loom switch <leader|auditor|worker> --project DIR --to <1-based index|cli/model/effort[/fast]>'],
  daemon: [daemonUsage],
  upgrade: [upgradeUsage],
  ls: ['loom ls [--project DIR]'],
  doctor: ['loom doctor --project DIR [--fix]', 'Reports project-owned residue. --fix cleans only resources with verified ownership.'],
  notifications: [
    'loom notifications [--project DIR] [--peek|--take|--history]',
    'loom notifications [--project DIR] [--needs-decision TEXT [--audit-escalation REASON] | --complete TEXT]',
    'loom notifications [--project DIR] --gate-complete ID',
    'Previews pending events by default. --take acknowledges them. --history includes acknowledged events.',
  ],
};
const commands = {
  hist: { ...strings('turn', 'turns', 'level', 'role', 'project', 'since', 'outcome', 'wave', 'grep', 'tool', 'cmd', 'tail'),
    ...flags('json', 'diff', 'evidence', 'only-failed', 'with-calls') },
  state: projectArgs, stop: projectArgs, ls: projectArgs, cost: projectArgs,
  status: { ...projectArgs, ...flags('json') },
  gate: { ...projectArgs, ...strings('base', 'candidate', 'question') },
  memory: { ...projectArgs, ...flags('json') },
  switch: { ...projectArgs, ...strings('to') },
  doctor: { ...projectArgs, ...flags('fix') },
  notifications: { ...projectArgs, ...flags('peek', 'take', 'history'),
    ...strings('needs-decision', 'audit-escalation', 'complete', 'gate-complete') },
};

const readPendingWork = (project, addr) => pendingWork(
  JSON.parse(readText(join(project, '.project', 'inbox', 'state.json'), '{"messages":[]}')).messages, addr);

function invalid(message) {
  throw new CommandError('invalid-arguments', message);
}

function positiveNumber(value) {
  const number = Number(value);
  if (/^\d+$/.test(value) && Number.isSafeInteger(number) && number > 0) return number;
}

function sinceValue(value) {
  const index = positiveNumber(value.replace(/^turn:/, ''));
  if (index !== undefined) return { index };
  const cursor = /^turn:([^#]+)#(\d+)$/.exec(value);
  if (cursor && positiveNumber(cursor[2]) !== undefined) return { addr: cursor[1], index: Number(cursor[2]) };
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
      if (turn.diff) console.log(JSON.stringify(turn.diff, null, 2));
      for (const card of turn.evidence ?? []) console.log(`${card.path}\n${card.summary ?? ''}`);
    }
  }
  for (const gap of result.missing ?? []) console.log(`\n${gap.addr} · ${gap.message}`);
}

async function hist(values, positionals, directory) {
  const { role, wave, outcome, tool, grep } = values;
  const onlyFailed = values['only-failed'];
  const withCalls = values['with-calls'];
  const toolFilters = tool || values.cmd !== undefined || values.tail !== undefined || onlyFailed || withCalls;
  const level = values.level ?? (toolFilters ? 'L2' : 'L1');
  if (!['L1', 'L2'].includes(level)) invalid('Expected L1 or L2 for --level');
  if (outcome !== undefined && !['failed', 'aborted', 'quota', 'blocked', 'unverified', 'recovered'].includes(outcome)) invalid('Invalid --outcome');
  if (tool !== undefined && !['shell', 'edit', 'read', 'other'].includes(tool)) invalid('Expected shell, edit, read or other for --tool');
  if (level === 'L1' && toolFilters) invalid('Tool filters require L2');
  for (const key of ['turn', 'turns', 'tail']) {
    if (values[key] !== undefined && positiveNumber(values[key]) === undefined) invalid(`Expected a positive integer for --${key}`);
  }
  if (values.turn !== undefined && (values.turns !== undefined || values.since !== undefined)) invalid('--turn cannot be combined with --turns or --since');
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
  const count = positiveNumber(values.turns) ?? (outcome || grep || since ? Infinity : level === 'L2' ? 1 : 5);
  const options = { level, count, since, exact, outcome, grep: grep?.toLowerCase(), tool, command,
    tail: positiveNumber(values.tail) ?? 20, showDiff, evidence, onlyFailed, withCalls };
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
    invalid(error.message);
  }
}

const emit = value => console.log(JSON.stringify(value));
const errorExit = code => code === 'invalid-arguments' ? 2 : ['not-found', 'ambiguous-target'].includes(code) ? 3 : 1;

export async function main(args) {
  const [command, ...rest] = args;
  if (!command || args.length === 1 && ['--help', '-h'].includes(command)) {
    console.log([...Object.values(help).flat(), projectOption].join('\n'));
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
    if (command === 'upgrade') {
      const result = await upgrade(rest);
      emit(result);
      return result.ok ? 0 : 1;
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
    const { values, positionals } = parse(command, rest);
    if (command === 'doctor' && values.project === undefined) invalid(help.doctor[0]);
    const directory = projectDirectory(values.project);
    let result;
    if (command === 'memory') {
      const [action, query] = positionals;
      if (positionals.length !== 2 || action !== 'search' || !query.trim()) invalid(help.memory[0]);
      const matches = searchMemory(directory, query);
      if (values.json) emit(matches);
      else if (matches.length) console.log(matches.map(indexLine).join('\n'));
      return 0;
    } else if (command === 'gate') {
      const [action, gate] = positionals;
      if (positionals.length !== 2 || action !== 'pack') invalid(help.gate[0]);
      try { result = await request(directory, 'gate-pack', { gate, base: values.base, candidate: values.candidate,
        question: values.question }); }
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
    } else if (command === 'hist') {
      result = await hist(values, positionals, directory);
      if (!values.json) { printHistory(result); return 0; }
    } else if (command === 'state' || command === 'stop') {
      if (positionals.length !== 1 || !positionals[0].trim()) invalid(`Expected one ${command} target`);
      const sessions = projectSessions(directory, values.project !== undefined || Boolean(process.env.LOOM_PROJECT));
      const session = resolveTarget(sessions, positionals[0], callerAddress());
      if (managedProject(directory)) {
        try {
          result = await request(directory, command, { target: session.addr });
        } catch (error) {
          if (!daemonAbsent(error)) throw error;
          if (command === 'stop') throw new CommandError('not-ready', 'loomd is not running for this project');
          result = { ok: true, addr: session.addr, state: session.endedAt === null ? 'offline' : 'exited',
            deliveries: [], ...readPendingWork(directory, session.addr) };
        }
      } else if (command === 'state') {
        result = { ok: true, addr: session.addr, ...await readState(session), ...readPendingWork(directory, session.addr) };
      } else {
        throw new CommandError('unsupported', 'loom stop requires a daemon-managed session');
      }
      if (command === 'state') {
        result.rotations ??= projectIndex(directory).rotations().filter(item => item.project === session.project);
        result = await withTuiVersionWarnings(presentState(result, session, directory), session);
      }
    } else {
      if (positionals.length) invalid(help[command][0]);
      if (command === 'status') {
        const { projectStatus, printStatus } = await import('./status.mjs');
        result = await projectStatus(directory);
        if (!values.json) { printStatus({ ...result, ...projectReceipt(directory) }); return 0; }
      } else if (command === 'cost') {
        const { projectCost } = await import('./cost.mjs');
        result = { ok: true, ...projectCost(directory, projectSessions(directory)) };
      } else if (command === 'doctor') {
        const { doctor } = await import('./doctor.mjs');
        result = await doctor(directory, Boolean(values.fix));
      } else if (command === 'notifications') {
        const decision = values['needs-decision'];
        const auditEscalation = values['audit-escalation'];
        const gateComplete = values['gate-complete'];
        const writes = [values.complete, decision, gateComplete].filter(value => value !== undefined).length;
        if ([values.peek, values.take, values.history].filter(Boolean).length > 1 ||
            writes > 1 || auditEscalation !== undefined && decision === undefined ||
            (values.take || values.history) && writes) invalid(help.notifications[0]);
        try { result = await request(directory, command, { take: values.take, history: values.history,
          decision, auditEscalation, gateComplete, complete: values.complete }); }
        catch (error) {
          if (!daemonAbsent(error)) throw error;
          if (values.take || writes) {
            throw new CommandError('not-ready', 'loomd is not running for this project');
          }
          result = { ok: true, notifications: readNotifications(directory).filter(event => values.history || event.takenAt == null) };
        }
      } else {
        let work = readPendingWork(directory);
        if (managedProject(directory)) {
          try {
            const { pendingDeliveries, pendingContinuations } = await request(directory, 'ls');
            work = { pendingDeliveries, pendingContinuations };
          } catch (error) { if (!daemonAbsent(error)) throw error; }
        }
        result = { ok: true, ...work, sessions: projectSessions(directory, values.project !== undefined || Boolean(process.env.LOOM_PROJECT)) };
      }
    }
    emit({ ...result, ...projectReceipt(directory) });
    return 0;
  } catch (error) {
    const code = typeof error.code === 'string' && /^[a-z-]+$/.test(error.code) ? error.code : 'unavailable';
    emit({ ok: false, error: { code, message: error.message } });
    return errorExit(code);
  }
}
