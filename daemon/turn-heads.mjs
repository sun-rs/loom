import { join } from 'node:path';
import { runtimeDirectory } from '../cli/project.mjs';
import { projectText } from '../cli/artifacts.mjs';
import { mergeBoundary, worktreeAt, worktreeDelta } from '../evidence/worktree.mjs';
import { readText, writeState } from './io.mjs';

export const headAt = worktreeAt;
const readSettings = project => JSON.parse(projectText(project, 'evidence.json') ?? '{}');
function settingsFor(project, row) {
  const settings = readSettings(project);
  return { ...settings, ...settings.tasks?.[row.task] };
}
const capturedSettings = ({ mergeRef, protectedPaths, testPaths, allowedPaths }) =>
  ({ mergeRef, protectedPaths, testPaths, allowedPaths });

export function finishHead(project, row, start, end = headAt(row.cwd)) {
  let git;
  try {
    git = worktreeDelta(row.cwd, start, end, settingsFor(project, row));
  } catch {
    git = { status: 'unavailable' };
  }
  return { head: end.head, observedAt: end.observedAt, git };
}

export function captureOarTurnEnd(project, row) {
  const gitBoundary = headAt(row.cwd);
  try {
    const projectSettings = readSettings(project);
    const task = projectSettings.tasks?.[row.task];
    const settings = gitBoundary.settings = capturedSettings({ ...projectSettings, ...task });
    const { mergeRef } = settings;
    gitBoundary.mergeBoundary = mergeBoundary(row.cwd, mergeRef);
    gitBoundary.projectScope = task ? { settings: capturedSettings(projectSettings),
      mergeBoundary: projectSettings.mergeRef === mergeRef ? gitBoundary.mergeBoundary : mergeBoundary(row.cwd, projectSettings.mergeRef) } : null;
  } catch { gitBoundary.settings = null; }
  return { head: gitBoundary.head, observedAt: gitBoundary.observedAt, gitBoundary };
}

export function oarTurnEndHead(project, row, start, end, { nextCard = false } = {}) {
  if (end?.gitBoundary) {
    const boundary = end.gitBoundary;
    if (nextCard && boundary.projectScope === undefined && boundary.settings !== null) {
      // Hosts attached before the upgrade may only have captured the startup card's scope.
      const { mergeBoundary: _, ...legacy } = boundary;
      return finishHead(project, { cwd: row.cwd }, start, legacy);
    }
    const scope = nextCard ? boundary.projectScope ?? boundary : boundary;
    const { settings, mergeBoundary } = scope;
    if (settings === undefined) return finishHead(project, row, start, boundary);
    return { head: end.head, observedAt: end.observedAt,
      git: settings ? worktreeDelta(row.cwd, start, { ...boundary, mergeBoundary }, settings) : { status: 'unavailable' } };
  }
  if (end?.observedAt) return { head: end.head, observedAt: end.observedAt, git: end.git };
}

export const turnHeadsPath = (project, addr) => join(runtimeDirectory(project), 'sessions', `${addr}.turn-heads.json`);
const isStart = event => event.hook_event_name === 'UserPromptSubmit' ||
  event.hook_event_name === 'PreInvocation' && Number(event.invocationNum ?? 0) === 0;
const isEnd = event => !event.paused && (event.fullyIdle === true && event.executionNum != null ||
  ['Stop', 'StopFailure', 'Interrupt'].includes(event.hook_event_name) && event.fullyIdle !== false);
const idOf = event => event.turn_id ?? event.turnId ?? event.turnStep;
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const compatible = (a, b) => a == null || b == null || sameId(a, b);
const fresh = event => Math.abs(Date.now() - event.receivedAt) <= 5000;
const save = (path, records) => writeState(path, JSON.stringify(records) + '\n');

export function observeTuiHeads(project, row, events) {
  const startIndex = events.findLastIndex(isStart);
  if (startIndex < 0) return;
  const start = events[startIndex];
  if (!Number.isFinite(start.receivedAt)) return;
  const end = events.slice(startIndex + 1).findLast(event => isEnd(event) && compatible(idOf(start), idOf(event)));
  const path = turnHeadsPath(project, row.addr);
  const records = JSON.parse(readText(path, '[]'));
  const previous = records.find(item => start.deliveryId != null && item.deliveryId === start.deliveryId ||
    item.startedAt === start.receivedAt && compatible(item.turnId, idOf(start)));
  if (previous?.end || previous?.endSnapshot) return;
  const record = previous ?? {};
  if (!end && !record.start && fresh(start)) record.start = headAt(row.cwd);
  if (end && fresh(end)) {
    record.endedAt = end.receivedAt;
    // Delivery linking can supply the pre-send boundary if both hooks arrived at once.
    const snapshot = headAt(row.cwd);
    if (record.start) record.end = finishHead(project, row, record.start, snapshot);
    if (record.deliveryId == null) record.endSnapshot = snapshot;
    if (end.hook_event_name === 'Interrupt' || end.is_interrupt) record.interruptedBy = 'user';
    if (end.hook_event_name === 'StopFailure') record.failure = { kind: 'failed', message: end.error ?? end.error_message };
  }
  if (!record.start && !record.endSnapshot) return;
  record.startedAt = start.receivedAt;
  record.turnId ??= idOf(start) ?? null;
  if (!previous) records.push(record);
  save(path, records);
}

export function saveTuiInputHead(project, row, message) {
  if (!row || message.mode === 'steer') return;
  const path = turnHeadsPath(project, row.addr);
  const records = JSON.parse(readText(path, '[]'));
  if (records.some(item => item.deliveryId === message.id)) return;
  records.push({ deliveryId: message.id, start: headAt(row.cwd) });
  save(path, records);
}

export function linkTuiInputHead(project, row, message, native) {
  if (!native || native.dropped || message.mode === 'steer') return;
  const path = turnHeadsPath(project, row.addr);
  const records = JSON.parse(readText(path, '[]'));
  const record = records.find(item => item.deliveryId === message.id);
  if (!record || record.startedAt != null && (!native.completion || record.end)) return;
  const at = native.at;
  if (!Number.isFinite(at)) return;
  const sampled = records.find(item => item !== record &&
    (item.startedAt === at || item.endedAt === native.completion?.at && item.endedAt != null || sameId(item.turnId, idOf(native))));
  record.turnId ??= idOf(native) ?? sampled?.turnId ?? null;
  record.startedAt ??= at;
  if (record.startedAt === native.completion?.at && sampled?.startedAt != null) record.startedAt = sampled.startedAt;
  record.endedAt ??= native.completion?.at ?? sampled?.endedAt;
  record.interruptedBy ??= sampled?.interruptedBy;
  record.failure ??= sampled?.failure;
  if (sampled?.endSnapshot || native.completion && Math.abs(Date.now() - native.completion.at) <= 5000) {
    record.end ??= finishHead(project, row, record.start, sampled?.endSnapshot);
  }
  if (sampled) {
    // Prefer the pre-send baseline. A snapshot used for an earlier computed delta
    // cannot substitute for it if no end observation remains available.
    if (sampled.end?.git?.baseCommit === record.start?.head && sampled.start?.tree === record.start?.tree) {
      record.end ??= sampled.end;
    }
    records.splice(records.indexOf(sampled), 1);
  }
  save(path, records);
}
