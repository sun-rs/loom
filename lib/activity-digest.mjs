import { basename, relative } from 'node:path';
import { turnActivity } from '../adapters/codex/activity.mjs';
import { checkEvidence, clip, shellBody } from '../evidence/checks.mjs';
import { assertionCounts, isCredentialPath } from '../evidence/git.mjs';
import { promptPreview } from './prompt-preview.mjs';

const oneLine = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const firstLine = value => String(value ?? '').trimStart().split(/\r?\n/, 1)[0];
const quotaText = /\b(?:HTTP\s*429|rate[_ -]limit(?:ed| exceeded| reached)|quota (?:exceeded|exhausted)|usage limit reached|too many requests)\b/i;
const sandboxText = /\b(?:sandbox (?:denied|violation|blocked)|denied by (?:the )?sandbox|sandbox[^\n]{0,48}operation not permitted|operation not permitted|sandbox restrictions)\b/i;
const userInterrupt = /\[Request interrupted by user|user (?:cancel(?:l)?ed|interrupt(?:ed)?)|user doesn't want to proceed/i;

function errorsFrom(rows) {
  return rows.flatMap(({ row }) => {
    const value = row.payload ?? row;
    if (!/^(?:error|api_error|stopfailure|failed)$/i.test(value.type ?? row.hook_event_name ?? '')) return [];
    const failure = value.error ?? value.message ?? value.content;
    if (typeof failure === 'string') return [failure];
    return typeof failure?.message === 'string' ? [failure.message] : [];
  });
}

export function shellReads(command) {
  const tokens = shellBody(command).match(/&&|\|\||[;|\n]|(?:'[^']*'|"[^"]*"|[^\s'";|&])+/g) ?? [];
  const paths = [];
  let stage = [];
  for (const token of [...tokens, ';']) {
    if (!['&&', '||', ';', '|', '\n'].includes(token)) {
      stage.push(token.replace(/^(['"])(.*)\1$/, '$2'));
      continue;
    }
    const [exe, ...args] = stage;
    const tool = basename(exe ?? '');
    const candidates = tool === 'sed' && args[0] === '-n' && /^\d+(?:,\d+)?p$/.test(args[1]) ? args.slice(2) :
      ['cat', 'nl', 'head', 'tail', 'wc'].includes(tool) ? args : [];
    paths.push(...candidates.filter(arg => /^[\w./][\w./-]*$/.test(arg) && /[./]/.test(arg)));
    stage = [];
  }
  return paths;
}

const toolIdentity = (tool, cwd) => `${tool.cwd ?? cwd ?? ''}\0${shellBody(tool.command ?? '')}`;
const allChecks = tools => tools.flatMap(tool => {
  if (tool.tool !== 'shell') return [];
  const check = checkEvidence({ ...tool, started: true });
  return check ? [{ ...check, ordinal: tool.ordinal, timestamp: tool.timestamp }] : [];
});

export function turnActivityFacts({ turn, rows, observation, completion, hook, tools, git, cwd, loomInterrupt }) {
  const errors = errorsFrom(rows);
  const native = observation?.end?.outcome ?? completion?.outcome ?? hook?.failure;
  const quota = ['quota', 'rate_limited'].includes(native?.failure) ||
    [...errors, native?.message].some(value => typeof value === 'string' && (quotaText.test(value) || /^rate[-_ ]limit$/i.test(value.trim()))) ||
    rows.some(({ row }) => /^(?:error|api_error)$/i.test(row.payload?.type ?? row.type) &&
      [429, '429', 'rate_limit_exceeded', 'insufficient_quota'].includes(
        row.payload?.error?.code ?? row.payload?.status ?? row.error?.status ?? row.statusCode));
  const declared = /^\**(DONE|FAILED|BLOCKED|UNCONFIRMED)\b/i.exec(firstLine(turn.reply))?.[1]?.toLowerCase();
  const interrupted = native?.kind === 'aborted' || turn.status === 'interrupted';
  const lifecycle = interrupted ? 'interrupted' : quota ? 'quota' : native?.kind === 'failed' || turn.status === 'failed' || turn.status === 'incomplete' && errors.length ? 'failed' :
    native?.kind === 'completed' ? 'completed' : turn.status;
  const interruptedBy = interrupted ? (loomInterrupt ? 'loom' : null) ?? observation?.end?.interruptedBy ?? hook?.interruptedBy ??
    (rows.some(({ row }) => (row.payload?.type === 'turn_aborted' && /^(?:user|interrupt|interrupted)$/i.test(row.payload.reason ?? '')) ||
      (row.type === 'user' && JSON.stringify(row.message?.content ?? row.content ?? '').match(userInterrupt))) ? 'user' : 'unknown') : null;

  const tests = allChecks(tools);
  const lastTests = new Map(tests.map(check => [toolIdentity(check, cwd), check]));
  const testOrdinals = new Set(tests.map(test => test.ordinal));
  const laterSuccesses = new Set();
  const nonZero = [];
  for (const tool of tools.toReversed()) {
    if (tool.tool !== 'shell' || !Number.isSafeInteger(tool.exitCode)) continue;
    const key = toolIdentity(tool, cwd);
    if (tool.exitCode === 0 && tool.command) laterSuccesses.add(key);
    if (tool.exitCode !== 0) nonZero.push({ ...tool, recovered: Boolean(tool.command && laterSuccesses.has(key)) });
  }
  nonZero.reverse();
  const testEdits = (git?.tests ?? []).map(assertionCounts);
  const guards = {
    outOfScope: git?.status === 'ok' && git.scopeConfigured ? git.scopeHits.length : null,
    protected: git?.status === 'ok' ? git.protectedHits?.length ?? null : null,
    assertions: git?.status === 'ok' ? testEdits.reduce((total, test) => total + test.removedAssertions, 0) : null,
    rewrittenAssertions: git?.status === 'ok' ? testEdits.reduce((total, test) => total + test.rewrittenAssertions, 0) : null,
    skip: git?.status === 'ok' ? (git.tests ?? []).reduce((total, test) => total + (test.changes?.addedSkip ?? 0), 0) : null,
    only: git?.status === 'ok' ? (git.tests ?? []).reduce((total, test) => total + (test.changes?.addedOnly ?? 0), 0) : null,
    sandboxDenials: tools.filter(tool => tool.denied || tool.exitCode !== 0 && sandboxText.test(tool.output ?? '')).length +
      Number(!tools.some(tool => tool.denied || tool.exitCode !== 0 && sandboxText.test(tool.output ?? '')) &&
        [...errors, native?.message].some(value => sandboxText.test(value ?? ''))),
  };
  const tags = [];
  if (quota) tags.push('quota');
  if (interrupted) tags.push('aborted');
  if (declared === 'blocked' || guards.sandboxDenials && lifecycle !== 'completed') tags.push('blocked');
  if (lifecycle === 'failed' || declared === 'failed' || [...lastTests.values()].some(test => test.result === 'failed')) tags.push('failed');
  if (nonZero.some(tool => tool.recovered)) tags.push('recovered');
  if (completion?.unconfirmed || observation?.unconfirmed || observation?.end?.unconfirmed || declared === 'unconfirmed') tags.push('unverified');

  const readPaths = new Set();
  for (const tool of tools) {
    const paths = tool.tool === 'read' ? tool.paths : tool.exitCode === 0 && tool.command ? shellReads(tool.command) : [];
    for (const path of paths) {
      const local = cwd && path.startsWith('/') ? relative(cwd, path) : path.replace(/^\.\//, '');
      if (local && !isCredentialPath(local)) readPaths.add(local);
    }
  }
  const prompts = turn.prompts ?? turnActivity.get(turn)?.prompts ?? [];
  const midTurnInputs = Math.max(0, (observation?.end?.inputIds?.length ?? 1) - 1, prompts.length - 1);
  const ended = turn.endedAt != null || observation?.end || completion?.at != null || hook?.end;
  return { errors, lifecycle, tags, tests, nonZero, guards, interruptedBy, midTurnInputs,
    ...(ended && { openCalls: tools.filter(tool => tool.status === 'open').length }),
    prompt: promptPreview(prompts[0] ?? rows.find(({ row }) => ['USER_EXPLICIT', 'USER'].includes(row.source) &&
      ['USER_INPUT', 'REQUEST'].includes(row.type))?.row.content), readCount: readPaths.size,
    otherCommands: tools.filter(tool => tool.tool === 'shell' && !testOrdinals.has(tool.ordinal) &&
      (tool.exitCode === 0 || tool.exitCode === null)).length };
}

const signed = value => value == null ? '?' : `${value >= 0 ? '+' : ''}${value}`;
const testCount = ({ counts, total }) => counts.passed === null ? `count unrecognised${total == null ? '' : ` (${total} total)`}` :
  `${counts.passed}/${total ?? '?'}${counts.skipped ? ` skip ${counts.skipped}` : ''}`;
const shown = value => value ?? '?';
const statusLabel = { completed: '完成', interrupted: '中断', quota: '限流', failed: '失败', incomplete: '未完成', paused: '后台进行中' };

export function activitySummary({ index, task, turn, tools, facts, activity, source, git, heads }) {
  const { lifecycle, errors, tests, nonZero, guards, interruptedBy, midTurnInputs, prompt, readCount, otherCommands, tags } = activity;
  const abnormal = lifecycle !== 'completed' || tags.some(tag => tag !== 'unverified') || nonZero.length ||
    facts.claims.includes('MISMATCH') || Object.values(guards).some(value => value > 0);
  const budget = abnormal ? 800 : 600;
  const started = typeof turn.startedAt === 'number' ? turn.startedAt : Date.parse(turn.startedAt ?? '');
  const ended = typeof turn.endedAt === 'number' ? turn.endedAt : Date.parse(turn.endedAt ?? '');
  const seconds = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, Math.round((ended - started) / 1000)) : null;
  const time = seconds === null ? '?' : seconds >= 60 ? `${Math.floor(seconds / 60)}m${seconds % 60}s` : `${seconds}s`;
  const head = git?.head ?? heads.end?.head;
  const base = git?.baseCommit ?? heads.start?.head;
  const boundary = git?.source === 'git-worktree' ? git.uncommitted ?
    `未提交 ${base?.slice(0, 7) ?? '?'}${base !== head ? ` → ${head?.slice(0, 7) ?? '?'}` : ''}` :
    head !== base ? `提交 ${head?.slice(0, 7) ?? '?'}` : `无提交 ${head?.slice(0, 7) ?? '?'}` : '提交状态未知';
  const header = `${task ? clip(task, 35) + ' ' : ''}第 ${index} 轮 ${statusLabel[lifecycle] ?? lifecycle} · ${time} · 工具 ${tools.length} · ${boundary}`;
  const fileRows = git?.status === 'ok' ? git.files.map(file =>
    `${clip(oneLine(file.path), 85)} +${shown(file.added)}/-${shown(file.deleted)}`) : [];
  const fileLine = git?.status === 'ok' ?
    `改动 ${git.files.length} · 净 ${signed(git.numstat?.net ?? 0)} · Git` :
    `改动未知 (${git?.status ?? 'missing-boundary'})`;
  const groups = [...Map.groupBy(tests, test => toolIdentity(test)).values()];
  const testLines = groups.slice(0, 3).map(group => {
    const command = clip(oneLine(shellBody(group[0].command)), 52);
    const sequence = group.map(testCount);
    const counts = sequence.length > 4 ? [sequence[0], '…', ...sequence.slice(-2)] : sequence;
    return `测试 ${command} ×${group.length} ${clip(counts.join(' → '), 75)} · exit ${shown(group.at(-1).exitCode)}`;
  });
  if (groups.length > testLines.length) testLines.push(`另有 ${groups.length - testLines.length} 条测试命令见 --json`);
  if (!testLines.length) testLines.push('测试 —');
  const nonZeroLine = nonZero.length ? `非零退出 ${nonZero.length} · ` + nonZero.slice(0, 3).map(tool =>
    `(${tool.exitCode}) ${tool.recovered ? 'recovered ' : '未恢复 '}${clip(oneLine(shellBody(tool.command ?? '?')), 47)}`).join(' · ') : '';
  const flags = `护栏 越界 ${shown(guards.outOfScope)} · 保护 ${shown(guards.protected)} · 断言删/改 ${shown(guards.assertions)}/${shown(guards.rewrittenAssertions)} · skip/only ${shown(guards.skip)}/${shown(guards.only)} · 沙箱拒绝 ${guards.sandboxDenials}`;
  const inputs = `轮中输入 ${midTurnInputs}${interruptedBy ? ` · 中断方 ${interruptedBy}` : ''}` +
    (activity.openCalls ? ` · 未结束工具 ${activity.openCalls}` : '');
  const locator = source.transcriptPath ? `${clip(basename(source.transcriptPath), 76)}${source.startLine ? `:${source.startLine}-${source.endLine}` : ''}` : '?';
  const footer = `原件 ${locator} · 读文件 ${readCount} · 其他命令 ${otherCommands}`;
  const claims = `声称 ${facts.claims.join('/') || '—'}`;
  const reply = `回复 ${clip(oneLine(turn.reply) || '—', 90)}`;
  const taskPreview = prompt && `任务 ${clip(prompt, 64)}`;
  const diagnostic = errors[0] && `错误 ${clip(oneLine(errors[0]), 75)}`;

  // Keep each category visible within the byte cap. Full file and tool lists are in JSON and --diff / L2.
  const rows = [header, reply, fileLine, ...fileRows, ...testLines, nonZeroLine, claims, flags, inputs, footer, taskPreview, diagnostic].filter(Boolean);
  const size = () => Buffer.byteLength(rows.join('\n'));
  while (size() > budget && fileRows.length > 1) {
    rows.splice(rows.indexOf(fileRows.pop()), 1);
  }
  if (git?.files?.length > fileRows.length) rows[rows.indexOf(fileLine)] += ` (+${git.files.length - fileRows.length} 行见 --diff)`;
  for (const [original, minimum] of [[diagnostic, 0], [reply, 22], [nonZeroLine, 42], [taskPreview, 24],
    [fileRows[0], 20], [footer, 28]]) {
    const position = rows.indexOf(original);
    if (size() <= budget || position < 0) continue;
    const allowance = Math.max(minimum, Buffer.byteLength(original) - (size() - budget));
    if (allowance === 0) rows.splice(position, 1);
    else rows[position] = clip(original, allowance);
  }
  return clip(rows.join('\n'), budget);
}
