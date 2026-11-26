import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { readText } from '../daemon/io.mjs';
import { worktreeAt, worktreeDelta } from '../evidence/worktree.mjs';

const budgetLine = /^\s*(?:[-*]\s*)?(?:\|\s*)?(?:\*\*)?(?:(?:card |net lines? |line )?budget(?: limit)?|(?:卡片)?(?:净行数|行数)?预算(?:上限)?)(?:\*\*)?(?:\s*[:：|]\s*|[ \t]+)(?:\*\*)?(?:≤|<=|max(?:imum)?\s*)?\s*(\d+)(?=\s|[|*行]|$)/im;
const median = values => {
  const sorted = values.toSorted((a, b) => a - b);
  const half = sorted.length >> 1;
  return (sorted[half] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
};

function taskDirectories(row, project) {
  const directories = [];
  for (const root of new Set([project, row.cwd])) {
    const path = join(root, 'tasks', row.task);
    if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory() && realpathSync(path) === path) directories.push(path);
  }
  return directories;
}

function text(path) {
  if (lstatSync(path, { throwIfNoEntry: false })?.isFile()) return readText(path);
  return '';
}

export const cardTexts = (row, project) => taskDirectories(row, project).map(directory => text(join(directory, 'TASK.md')));

export function sampleCard(row, project, start, policy, card, emit) {
  const directories = taskDirectories(row, project);
  const declared = directories.map(directory => budgetLine.exec(text(join(directory, 'TASK.md')))?.[1])
    .find(value => value != null);
  const limit = declared != null && Number.isSafeInteger(Number(declared)) ? Number(declared) : policy.netLines;
  if (Number.isSafeInteger(limit)) {
    if (Number.isSafeInteger(card.budget) && limit > card.budget) card.raises = (card.raises ?? 0) + 1;
    card.budget = limit;
    if (policy.budgetRaises != null && (card.raises ?? 0) >= policy.budgetRaises) {
      emit('budget-raised', '', { raises: card.raises, budget: limit });
    }
    const net = start && worktreeDelta(row.cwd, start, worktreeAt(row.cwd)).numstat?.net;
    if (net > limit) emit('line-budget', '', { net, budget: limit });
  }
  if (policy.planLines != null) {
    for (const directory of directories.toReversed()) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^PLAN.*\.md$/.test(entry.name)) continue;
        const content = text(join(directory, entry.name));
        const lines = content ? content.replace(/\r?\n$/, '').split(/\r?\n/).length : 0;
        if (lines > policy.planLines) emit('plan-growth', entry.name, { file: entry.name, lines, limit: policy.planLines });
      }
    }
  }
}

export function observeExecutions(card, timings, executions, failure, policy, emit, { expectRed = false } = {}) {
  const failures = failure && !(expectRed && failure === 'test-failed') ? [failure] : [];
  for (const { command, kind, durationMs, exitCode } of executions) {
    if (Number.isSafeInteger(exitCode) && exitCode !== 0 && !(expectRed && kind === 'test')) failures.push(kind + '-failed');
    if (policy.slowCommandFactor == null || !(durationMs > 0)) continue;
    const key = JSON.stringify(command);
    const samples = timings[key] ??= [];
    if (samples.length >= policy.slowCommandSamples) {
      const medianMs = median(samples);
      if (durationMs > policy.slowCommandFactor * medianMs) {
        emit('slow-command', command, { command, durationMs, medianMs });
      }
    }
    samples.push(durationMs);
  }
  if (policy.repeatedFailures != null) {
    for (const failureClass of failures) {
      card.failures ??= {};
      const key = JSON.stringify(failureClass);
      const count = card.failures[key] = (card.failures[key] ?? 0) + 1;
      if (count >= policy.repeatedFailures) emit('repeated-failure', failureClass, { failureClass, count });
    }
  }
}
