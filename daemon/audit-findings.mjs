import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { inDirectory } from '../cli/project.mjs';
import { CommandError } from '../cli/sessions.mjs';
import { isCredentialPath } from '../evidence/git.mjs';
import { gateId } from './gate-packet.mjs';
import { validInput } from './sessions.mjs';

export function summarizeAuditFindings(events, phase) {
  const findings = events.filter(event => event.type === 'audit-finding' && event.phase === phase);
  const closed = new Map(events.filter(event => event.type === 'audit-finding-closed' && event.phase === phase)
    .map(event => [event.finding, event]));
  const byCategory = Object.fromEntries([...Map.groupBy(findings, event => event.category)].sort(([a], [b]) => a.localeCompare(b))
    .map(([category, entries]) => [category, { reviewOnly: entries.length, open: entries.filter(entry => !closed.has(entry.finding)).length }]));
  return { phase, byCategory, findings: findings.map(({ finding, category, text, addr }) => ({
    id: finding, category, evidence: text, auditor: addr, regression: closed.get(finding)?.regression ?? null,
  })) };
}

export function requireAuditRegressions(events, phase) {
  const open = summarizeAuditFindings(events, phase).findings.filter(finding => !finding.regression);
  if (open.length) throw new CommandError('audit-findings-open',
    'Add a regression test or lint rule before closing phase ' + phase + ': ' + open.map(finding => finding.id).join(', '));
}

function regressionPath(project, path) {
  if (!validInput(path) || isAbsolute(path) || isCredentialPath(path) ||
      !/(?:^|\/)(?:lint\/|loom\.lint\.json$)|(?:\.(?:test|spec)\.[a-z]+|\/(?:test_[^/]+|[^/]+_test)\.py)$/i.test(path)) return;
  const target = resolve(project, path);
  if (inDirectory(project, target) && lstatSync(target, { throwIfNoEntry: false })?.isFile() && realpathSync(target) === target) return path;
}

export function recordAuditFinding(project, name, actor, args, notifications, now) {
  const { phase, id, category, evidence, regression } = args;
  if (typeof phase !== 'string' || !gateId.test(phase)) throw new CommandError('invalid-arguments', 'Supply a valid phase ID');
  const events = () => notifications.list(name, false, true);
  if ([id, category, evidence, regression].every(value => value === undefined)) return summarizeAuditFindings(events(), phase);
  if (!actor || actor.role !== 'auditor' || actor.endedAt !== null || actor.project !== name ||
      typeof id !== 'string' || !gateId.test(id)) {
    throw new CommandError('invalid-arguments', 'The live Auditor must supply a finding ID in this project');
  }
  const history = events();
  const prior = summarizeAuditFindings(history, phase).findings.find(finding => finding.id === id);
  const key = JSON.stringify([name, phase, id]);
  const entry = { project: name, phase, finding: id, at: now(), addr: actor.addr, logOnly: true };
  if (regression !== undefined) {
    if (category !== undefined || evidence !== undefined || !prior || !regressionPath(project, regression)) {
      throw new CommandError('invalid-arguments', 'Close a recorded finding with the project-relative path to its new regression test or lint rule');
    }
    if (prior.regression && prior.regression !== regression) throw new CommandError('id-conflict', 'This finding already has a regression path');
    notifications.add({ ...entry, id: 'audit-finding-closed:' + key, type: 'audit-finding-closed', regression });
  } else {
    if (typeof category !== 'string' || !gateId.test(category) || !validInput(evidence) || Buffer.byteLength(evidence) > 2048) {
      throw new CommandError('invalid-arguments', 'Record the category and up to 2048 bytes of evidence for a finding missed by checks');
    }
    if (prior && (prior.category !== category || prior.evidence !== evidence)) {
      throw new CommandError('id-conflict', 'This finding ID already has different evidence');
    }
    if (!prior && history.some(event => event.phase === phase && event.type === 'project-completed' ||
        event.gate === phase && ['gate-completed', 'auditor-rotation-proposed'].includes(event.type))) {
      throw new CommandError('not-ready', 'Record this finding in an open phase');
    }
    notifications.add({ ...entry, id: 'audit-finding:' + key, type: 'audit-finding', category, text: evidence });
  }
  return summarizeAuditFindings(events(), phase);
}
