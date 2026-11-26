import { execFile } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readArtifacts } from '../cli/artifacts.mjs';
import { runtimeDirectory } from '../cli/project.mjs';
import { collectGit } from '../evidence/git.mjs';
import { projectDocument, rulingLines } from '../handover/organization.mjs';
import { clipTokens } from '../lib/token-budget.mjs';
import { payloadDigest } from '../inbox/message.mjs';
import { writeState } from './io.mjs';

const exec = promisify(execFile);
async function git(cwd, ...args) {
  try {
    const { stdout } = await exec('/usr/bin/git', args, { cwd, timeout: 5000 });
    return stdout.trim();
  } catch (error) {
    if (error.code === 1 || error.code === 128) return null;
    throw new Error('Could not read the Worker Git state');
  }
}

export async function workerCheckpoint(project, row, card) {
  const [branchName, baseSha, rulings] = await Promise.all([
    git(row.cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD'),
    git(row.cwd, 'rev-parse', '--verify', '--quiet', 'HEAD'),
    projectDocument(project, 'rulings'),
  ]);
  if (rulings.status === '不可读') throw new Error('Could not read active project rulings');
  const wip = baseSha && await collectGit(row.cwd, { baseCommit: baseSha });
  if (baseSha && wip.status !== 'ok') throw new Error('Could not measure Worker WIP lines');
  const lines = wip && wip.files.filter(file => !file.path.split('/').includes('.project')).reduce((total, file) => ({
    added: total.added + (file.added ?? 0), deleted: total.deleted + (file.deleted ?? 0),
  }), { added: 0, deleted: 0 });
  return {
    branch: branchName ?? (baseSha ? 'DETACHED' : null),
    baseSha,
    wipLines: lines || null,
    rulingsDigest: rulings.text === undefined ? null : payloadDigest(rulings.text),
    rulings: rulings.text === undefined ? [] : rulingLines(rulings.text, card),
  };
}

export function workerCheckpointMismatch(expected, actual) {
  return ['branch', 'baseSha', 'wipLines', 'rulingsDigest'].filter(key =>
    JSON.stringify(expected[key]) !== JSON.stringify(actual[key]));
}

export function workerCheckpointText({ branch, baseSha, wipLines, rulingsDigest, rulings }) {
  return [
    `Branch ${branch ?? '(none)'}`, `Base SHA ${baseSha ?? '(none)'}`,
    `WIP lines ${wipLines ? '+' + wipLines.added + ' / -' + wipLines.deleted : '(unavailable)'}`,
    `Rulings ${rulingsDigest ? '.project/rulings.md · ' + rulingsDigest : '(none)'}`,
    ...rulings.map(text => clipTokens(text, 100)),
  ].join('\n');
}

export async function writeWorkerHandoff(project, row, card, reason, { acceptance = {}, evidence, cardId, startedAt }) {
  const directory = join(runtimeDirectory(project), 'worker-handoffs');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (realpathSync(directory) !== directory) throw new Error('Worker handoff directory must be project-local');
  const path = join(directory, `${row.addr}-${cardId}.md`);
  const checkpoint = await workerCheckpoint(project, row, card);
  const commands = readArtifacts(project).cards(row.addr).filter(item => item.data.endedAt >= startedAt)
    .flatMap(item => item.data.verification?.commands ?? []);
  const latest = new Map(commands.filter(item => item.command).map(item => [item.command, item.result]));
  const listed = passed => [...latest].filter(([, result]) => (result === 'passed') === passed)
    .map(([command, result]) => `- ${command} · ${result}`).join('\n');
  writeState(path, [
    `# Worker handoff · ${row.task}`, `Worker ${row.addr}\nWorktree ${row.cwd}\nReason ${reason}`,
    ...(evidence ? ['## Verified finding\n' + evidence] : []),
    '## Branch, base SHA, WIP and active rulings\n' + workerCheckpointText(checkpoint),
    '## Work in progress\n' + (acceptance.wip || 'Review the worktree and last native turn.'),
    '## Acceptance passed\n' + (acceptance.passed || listed(true) || 'No passing checks recorded.'),
    '## Acceptance remaining\n' + (acceptance.pending || listed(false) || 'Verify the remaining acceptance criteria on the card.'),
    '## Card\n' + card,
  ].join('\n\n') + '\n');
  return path;
}
