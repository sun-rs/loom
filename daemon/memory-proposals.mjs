import { CommandError } from '../cli/sessions.mjs';
import { validateProposalCommand } from '../cli/memory.mjs';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { activeItems, commitProjectMemory, prepareProjectMemory } from '../memory/project.mjs';
import { validateEntryFormat } from '../memory/format.mjs';
import { estimateTokens } from '../lib/token-budget.mjs';
import { digest, redactExtractor } from './memory-extractor-input.mjs';

const idPattern = /^[a-z0-9][a-z0-9_-]{0,127}$/;
const isId = value => typeof value === 'string' && idPattern.test(value);
const text = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit && !value.includes('\0');
const titleOK = value => text(value, 150) && !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(value);
const evidencePath = { delivery: '.project/inbox/state.json', event: '.project/loomd/notifications.json' };
const sourceKey = ({ kind, id }) => JSON.stringify([kind, id]);
const stringField = value => value === undefined || typeof value === 'string' ? value : null;
export function candidateFields(raw) {
  return {
    ...Object.fromEntries(['action', 'id', 'scope', 'title', 'body', 'target'].map(field => [field, stringField(raw?.[field])])),
    targets: Array.isArray(raw?.targets) ? raw.targets.map(stringField) : raw?.targets === undefined ? undefined : null,
    source: { kind: stringField(raw?.source?.kind), id: stringField(raw?.source?.id) },
  };
}
const normalize = value => value.toLowerCase().replace(/[.!?]+$/u, '').replace(/\s+/gu, ' ').trim();
const noiseSignals = [
  /^(?:git\s+(?:history|log)|code(?:base)?\s+(?:structure|layout)|current\s+(?:progress|status)|(?:git\s+)?(?:commit|revision)\s+`?[a-f\d]{7,64}\b)/iu,
  /\b(?:lives|is located|can be found)\s+in\s+[`'"]?(?:[\w.-]+\/)+[\w.-]+/iu,
  /\b(?:as\s+(?:already\s+)?documented\s+in\s+the\s+(?:repo(?:sitory)?|codebase)|(?:the\s+)?current\s+(?:command|build|test|job|task)\s+is\s+(?:waiting|running|pending))\b/iu,
  /^(?:the\s+)?(?:latest|last|current)\s+(?:build|test run|command|job)\s+(?:has\s+)?(?:passed|failed|finished|completed|timed out)\b/iu,
  /^(?:git\s*历史|代码结构|当前进度|当前状态|(?:提交|修订)\s*[a-f\d]{7,64}\b)|(?:已(?:在|由)(?:仓库|代码库)记录|(?:当前|本轮)(?:命令|构建|测试|任务)(?:正在|尚在)(?:运行|等待))/iu,
];
function isNoise(title, body) {
  const marker = label => new RegExp('^[ \\t]*(?:[-*] |#{1,6} )?(?:\\*\\*)?' + label +
    '(?:\\*\\*)?[ \\t]*[:：][ \\t]*(?:\\*\\*)?[^\\s*]', 'imu').test(body);
  if (marker('Why') && marker('How to apply')) return false;
  return [title, body].some(value => value && noiseSignals.some(pattern => pattern.test(value.trim())));
}
const revision = item => item?.meta ? digest(item) : item?.revision ?? null;
const userDraft = ({ title, body, createdAt, source, targets }, current) => ({
  layer: 'user', project: null, kind: current?.kind ?? 'preference',
  title: title ?? current?.title ?? Array.from(body?.split('\n', 1)[0] ?? '').slice(0, 150).join(''),
  body, checkedAt: createdAt, source: { path: evidencePath[source.kind] }, supersedes: targets,
});
const userFact = (received, body) => {
  const fact = normalize(body);
  // A user's exact statement is evidence. First-person preferences also
  // support the equivalent third-person statement for each listed preference.
  return received.split(/[.!?\n]+/u).map(normalize).some(line => {
    if (line === fact) return true;
    const preference = /^(?:i prefer|the user prefers) (.+)$/u.exec(line)?.[1];
    return preference?.split(/,\s*|\s+and\s+/u).some(value => fact === 'the user prefers ' + value);
  });
};

function projectPlan(project, item) {
  const { action, title, body, source, id, current, removed, createdAt } = item;
  const plan = [];
  if (action !== 'invalidate') {
    const meta = current?.meta ?? { id, scope: 'project', owner: 'auditor' };
    plan.push(prepareProjectMemory(project, { ...meta, source: evidencePath[source.kind],
      verified: createdAt.slice(0, 10), title: title ?? current?.title, body }));
  }
  for (const old of removed) plan.push(prepareProjectMemory(project, {
    ...old.meta, title: old.title, body: old.body,
    ...(action === 'invalidate' ? { invalidatedBy: id } : { supersededBy: current.meta.id }),
  }));
  return plan;
}

const scopedRole = scope => scope === 'user' ? 'super' : 'auditor';
const conflict = () => new CommandError('conflict', 'Memory proposal conflicts with the current library');

export function createMemoryProposals(project, { memory, sessions, state, save, now }) {
  const store = memory.store;
  const stageBinding = { sessionId: 'memory-extractor', principal: 'super', role: 'super', project, cardId: null };
  const auditorBinding = { ...stageBinding, principal: 'auditor', role: 'auditor' };
  const projectIdExists = id => Boolean(lstatSync(join(project, '.project', 'memory', 'items', id + '.md'),
    { throwIfNoEntry: false }));
  const callerBinding = caller => {
    const row = caller && sessions.rows().find(session => session.addr === caller || session.pane === caller);
    if (!row || row.endedAt !== null || row.project !== project) {
      throw new CommandError('forbidden', 'Memory proposal access is forbidden');
    }
    const binding = memory.bindingFor(row);
    if (!binding) throw new CommandError('forbidden', 'Memory proposal access is forbidden');
    return binding;
  };

  async function visibleItems(binding) {
    const { rows } = await store.access.index(binding);
    return (await Promise.all(rows.map(row => store.access.show(binding, row.id))))
      .map(result => result.item).filter(item => item?.status === 'active');
  }

  async function userItems(binding = stageBinding) {
    return (await visibleItems(binding)).filter(item => item.layer === 'user' &&
        ['ruling', 'preference'].includes(item.kind));
  }

  async function library() {
    return { project: activeItems(project), user: await userItems() };
  }

  async function stageLibrary() {
    return { project: activeItems(project), reference: (await visibleItems(auditorBinding))
      .filter(item => item.layer === 'shared' && item.project === project) };
  }

  async function queue(values, input, { stage = false, key } = {}) {
    if (!Array.isArray(values) || !values.length) return;
    const sources = new Map(input.map(row => [sourceKey(row.source), row]));
    const items = await library();
    const removals = { project: new Set(), user: new Set() };
    for (const raw of values.slice(0, 32)) {
      if (!raw || typeof raw !== 'object') continue;
      const { action, id, scope, source, title, body, target, targets = [] } = redactExtractor(candidateFields(raw), key);
      if (!isId(id) || Object.hasOwn(state.proposals, id) || !['project', 'user'].includes(scope) ||
          !(stage ? ['merge', 'invalidate', 'correct'] : ['add', 'merge', 'invalidate', 'correct']).includes(action) ||
          (title !== undefined && !titleOK(title)) || (action === 'add' && !titleOK(title)) ||
          (action !== 'invalidate' && (!text(body, 4000) || body.split(/\r\n|\n|\r/u).length > 200 ||
            estimateTokens(body) > 200)) || !Array.isArray(targets) || targets.length > 32 ||
          !targets.every(isId) || new Set(targets).size !== targets.length) continue;
      if (action !== 'invalidate' && isNoise(title, body)) continue;
      const proof = sources.get(sourceKey(source));
      if (!proof || !Object.hasOwn(evidencePath, source.kind) ||
          scope === 'user' && action !== 'invalidate' && !(proof.user && userFact(proof.text, body))) continue;
      const byId = new Map(items[scope].map(item => [item.meta?.id ?? item.id, item]));
      const current = byId.get(target);
      const removed = targets.map(id => byId.get(id));
      if (target !== undefined && !current || removed.some(item => !item || item === current) ||
          (action === 'add' && (target !== undefined || byId.has(id) || scope === 'project' && projectIdExists(id))) ||
          (['merge', 'correct'].includes(action) && !current &&
            !(scope === 'user' && action === 'correct' && target === undefined)) ||
          (['merge', 'invalidate'].includes(action) !== Boolean(targets.length)) ||
          (action === 'invalidate' && (target !== undefined || title !== undefined || body !== undefined))) continue;
      const deletions = new Set([...removals[scope], ...targets]);
      if (stage && deletions.size > Math.floor(byId.size / 5)) continue;
      const stored = { id, action, scope, source, ...(title !== undefined && { title }),
        ...(body !== undefined && { body }), ...(target !== undefined && { target }), targets,
        basis: Object.fromEntries([...targets, ...(current ? [target] : [])].map(id => [id, revision(byId.get(id))])),
        status: 'pending', createdAt: new Date(now()).toISOString() };
      if (scope === 'project') {
        try { projectPlan(project, { ...stored, current, removed }); } catch { continue; }
      } else if (action !== 'invalidate' && !validateEntryFormat(userDraft(stored, current)).ok) {
        continue;
      }
      removals[scope] = deletions;
      state.proposals[id] = stored;
    }
  }

  async function approve(item, binding) {
    const { scope, target, targets, action, id } = item;
    const existing = scope === 'project' ? activeItems(project) : await userItems(binding);
    const byId = new Map(existing.map(entry => [entry.meta?.id ?? entry.id, entry]));
    if (Object.entries(item.basis).some(([id, expected]) => revision(byId.get(id)) !== expected) ||
        scope === 'project' && action === 'add' && projectIdExists(id)) throw conflict();
    const current = byId.get(target);
    if (scope === 'project') {
      // Persist the approved file plan before applying it. Recovery can finish
      // the same writes if the process stops during a multi-item update.
      item.application = { files: projectPlan(project, { ...item, current, removed: targets.map(id => byId.get(id)) }) };
    } else {
      const revisions = Object.fromEntries(targets.map(id => [id, byId.get(id).revision]));
      const requestId = 'extractor-proposal:' + id;
      const request = { op: 'put', requestId, id: target, expectedRevision: current?.revision ?? null,
        supersedeExpectedRevisions: revisions, entry: userDraft(item, current) };
      item.application = { binding, ...(action === 'invalidate' ? { revisions, requestId } : { request }) };
    }
    save();
    await applyApproval(item);
  }

  async function applyApproval(item) {
    const { files, binding, revisions, requestId, request } = item.application;
    if (files) commitProjectMemory(project, files);
    else {
      const result = revisions ? await store.withdrawReviewed(binding, revisions, requestId) : await store.write(binding, request);
      if (!result.ok) {
        delete item.application;
        save();
        throw new CommandError(result.code, 'Memory proposal could not be applied');
      }
    }
    item.status = 'approved';
    delete item.application;
    save();
  }

  async function recover() {
    for (const item of Object.values(state.proposals)) {
      if (item.application) await applyApproval(item);
    }
  }

  async function handle(command, args, caller) {
    const binding = callerBinding(caller);
    if (command === 'memory-index' || command === 'memory-show') {
      if (binding.role !== 'super') throw new CommandError('forbidden', 'User memory access is forbidden');
      if (command === 'memory-index') {
        if (args.scope !== 'user') throw new CommandError('invalid-arguments', 'Expected user memory scope');
        const allowed = new Set((await userItems(binding)).map(item => item.id));
        const { rows } = await store.access.index(binding);
        return { rows: rows.filter(row => allowed.has(row.id)) };
      }
      if (typeof args.id !== 'string') throw new CommandError('invalid-arguments', 'Expected a memory ID');
      const result = await store.access.show(binding, args.id);
      return result.item?.layer === 'user' ? result : { item: null, seq: null };
    }
    const proposalCommand = command === 'memory-proposals';
    if (proposalCommand) validateProposalCommand(args);
    else if (!isId(args.id) || !['approve', 'reject'].includes(args.decision)) {
      throw new CommandError('invalid-arguments', 'Expected a proposal ID and approve or reject');
    }
    const forbidden = () => new CommandError('forbidden', 'Memory proposal access is forbidden');
    if (!['super', 'auditor'].includes(binding.role)) throw forbidden();
    const visible = item => scopedRole(item.scope) === binding.role ||
      (proposalCommand && binding.role === 'super' && item.scope === 'project');
    if (args.decision === 'list') {
      return { proposals: Object.values(state.proposals).filter(item => visible(item) && item.status === 'pending')
        .map(({ id, scope, status, action, title, body, target, targets }) =>
          ({ id, shortId: id.slice(0, 8), scope, status, action, title, body, target, targets })) };
    }

    let item = Object.hasOwn(state.proposals, args.id) ? state.proposals[args.id] : undefined;
    if (item && !visible(item)) item = undefined;
    if (!item && proposalCommand && args.id.length === 8) {
      const matches = Object.values(state.proposals).filter(item => visible(item) && item.id.startsWith(args.id));
      if (matches.length > 1) throw new CommandError('ambiguous', 'Ambiguous proposal ID. Use the full ID.');
      [item] = matches;
    }
    if (!item) throw forbidden();
    const ensurePending = () => {
      if (item.status !== 'pending') throw new CommandError('conflict', `Memory proposal is already ${item.status}`);
    };
    ensurePending();
    await recover();
    ensurePending();
    const status = args.decision === 'approve' ? 'approved' : 'rejected';
    if (status === 'approved') await approve(item, binding);
    else {
      if (proposalCommand && args.reason !== undefined) item.reason = redactExtractor(args.reason.trim());
      item.status = status;
      save();
    }
    return { id: item.id, status };
  }

  function pending(scope) {
    return Object.values(state.proposals).filter(item => item.scope === scope && item.status === 'pending');
  }
  function render(items) {
    return items.map(({ id, action, source, title, body, target, targets }) => JSON.stringify({
      id, action, source, title, body, target, targets,
    })).join('\n');
  }
  return { handle, queue, pending, render, stageLibrary, recover };
}
