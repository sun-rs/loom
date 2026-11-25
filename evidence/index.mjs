import { constants } from 'node:fs';
import { link, mkdir, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative } from 'node:path';
import { collectVerification } from './transcript.mjs';
import { collectGit, isCredentialPath } from './git.mjs';
import { compareClaims } from './claims.mjs';
import { checkEvidence } from './checks.mjs';
import { checkFacts } from './facts.mjs';
import { clipTokens } from '../lib/token-budget.mjs';

const safeKey = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const stores = { codex: '/.codex/sessions/', claude: '/.claude/projects/', agy: '/.gemini/antigravity-cli/brain/' };

export function inside(parent, child) {
  if (typeof child !== 'string' || !isAbsolute(child)) return false;
  const part = relative(parent, child);
  return !isAbsolute(part) && part !== '..' && !part.startsWith('../');
}

export async function localText(path) {
  try {
    if (await realpath(path) !== path) return undefined;
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { return (await file.stat()).isFile() ? await file.readFile('utf8') : undefined; }
    finally { await file.close(); }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export async function readTranscript(provider, cwd, path) {
  if (typeof path !== 'string' || !isAbsolute(path) || !/\.jsonl$/i.test(path) || isCredentialPath(path.slice(1))) return undefined;
  const store = stores[provider];
  if (!(cwd && inside(cwd, path)) && !(store && path.includes(store))) return undefined;
  return localText(path);
}

async function ensureDirectory(path) {
  try { await mkdir(path, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (await realpath(path) !== path) throw new Error('Evidence directory must be project-local');
}

async function writeOnce(path, data) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, data, { mode: 0o600, flag: 'wx' });
    try { await link(temp, path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { await rm(temp, { force: true }); }
}

function cardFor({ claims, git, verification, facts }) {
  const mismatches = claims.filter(claim => claim.status === 'MISMATCH');
  const uncertain = claims.filter(claim => claim.status === 'UNVERIFIED');
  const headline = `证据 ${mismatches.length ? `MISMATCH ${mismatches.length}` : '卡'}` +
    (uncertain.length ? ` · 待证 ${uncertain.length}` : '');
  const staticCounts = (git.tests ?? []).reduce((sum, test) => {
    for (const key of Object.keys(sum)) sum[key] += test.changes?.[key] ?? 0;
    return sum;
  }, { removedAssertions: 0, addedSkip: 0, addedOnly: 0 });
  const removed = git.tests?.filter(test => test.status === 'D').length;
  const changes = git.status === 'ok'
    ? `改动 ${git.files.length} · 保护 ${git.protectedHits.length} · 测试 ${git.tests.length}（删 ${removed}） · 断言 -${staticCounts.removedAssertions} · skip +${staticCounts.addedSkip} / only +${staticCounts.addedOnly}`
    : `Git ${git.status}`;
  const { commands } = verification;
  const passed = commands.filter(check => check.result === 'passed').length;
  const sandbox = commands.filter(check => check.sandboxed === true).length;
  const host = commands.filter(check => check.sandboxed === false).length;
  const verify = verification.status !== 'ok' ? `验证 ${verification.status}` : commands.length ?
    `验证 ${passed}/${commands.length} 通过 · 沙箱 ${sandbox} / 外 ${host} / 未知 ${commands.length - sandbox - host}` :
    '验证 无可确认测试命令';
  const results = [...mismatches, ...uncertain, ...claims.filter(claim => claim.status === 'MATCH')]
    .slice(0, 2).map(claim => `${claim.text} → ${claim.reason}`).join(' · ');
  const misses = facts?.misses ?? [];
  const factLine = misses.length && `fact-miss ${misses.length} · ${misses.slice(0, 3).map(fact => fact.value).join(' · ')}`;
  return clipTokens([headline, factLine, changes, verify, results].filter(Boolean).join('\n'), 299);
}

async function config(project) {
  const text = await localText(join(project, '.project/evidence.json'));
  return text === undefined ? {} : JSON.parse(text);
}

function globs(value = []) {
  if (!Array.isArray(value) || value.some(glob => typeof glob !== 'string' || !glob.trim())) throw new TypeError('Expected a list of globs');
  return value;
}

/** Observe and persist one worker turn. The first observation for a task/turn survives retries. */
export async function forTurn(options) {
  const { task, turn, provider, addr = null, endedAt = null, failed = false, transcript, finalReply } = options;
  const validTurn = typeof turn === 'string' && safeKey.test(turn) || Number.isSafeInteger(turn) && turn > 0;
  if (typeof task !== 'string' || !safeKey.test(task) || !validTurn) {
    throw new TypeError('Expected safe task and turn identifiers');
  }
  const project = await realpath(options.project);
  const cwd = options.cwd === null ? null : await realpath(options.cwd ?? project);
  if (cwd && !inside(project, cwd)) throw new Error('Worker cwd must be in the project');
  const parent = join(project, '.project');
  await ensureDirectory(parent);
  const directory = join(parent, 'evidence');
  await ensureDirectory(directory);
  const path = join(directory, `${task}-${turn}.json`);
  const textPath = join(directory, `${task}-${turn}.txt`);
  const previous = await localText(path);
  if (previous === undefined) {
    const settings = await config(project);
    const capturedAt = Date.now();
    const git = options.gitObservation ?? (cwd ? await collectGit(cwd, {
      baseCommit: options.baseCommit ?? settings.baseCommit,
      protectedPaths: globs(options.protectedPaths ?? settings.protectedPaths),
      extraTestPaths: globs(options.testPaths ?? settings.testPaths),
      mergeRef: options.mergeRef ?? settings.mergeRef,
    }) : { status: 'missing-cwd' });
    const { finalReply: nativeReply, ...verification } = collectVerification({ ...options, transcript });
    if (!verification.commands.length && options.projected) {
      const { tools, ...turn } = options.projected;
      Object.assign(verification, turn, { status: 'ok', commands: tools.flatMap(tool => {
        const check = tool.tool === 'shell' && checkEvidence({ ...tool, source: 'oar.tool_call_ended' });
        return check ? [check] : [];
      }) });
    }
    const reply = finalReply === undefined ? nativeReply : finalReply;
    const claims = compareClaims(reply, git, verification, failed);
    const facts = options.facts ?? (cwd && reply ? checkFacts(reply, cwd, project) : { checked: 0, misses: [] });
    const data = { version: 1, task, turn, addr, provider: provider ?? null, endedAt, capturedAt, git, verification, claims, facts };
    data.card = cardFor(data);
    await writeOnce(path, JSON.stringify(data, null, 2) + '\n');
  }
  const data = JSON.parse(previous ?? await readFile(path, { encoding: 'utf8', flag: constants.O_RDONLY | constants.O_NOFOLLOW }));
  await writeOnce(textPath, data.card + '\n');
  return { path, textPath, card: data.card, data };
}

export const evidence = { forTurn };
