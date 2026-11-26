import { projectCost, pyramidSampleReady, pyramidWindowMs } from '../cli/cost.mjs';
import { historyReader } from '../cli/history.mjs';
import { readArtifacts } from '../cli/artifacts.mjs';
import { timestamp } from '../cli/turns.mjs';
import { turnTools } from '../lib/turn-tools.mjs';
import { agyToolOutput, seniorOutputCategory, sumOutputTokens } from '../lib/senior-tool-output.mjs';
import { rootEvents, sessionContext } from '../lib/session-context.mjs';

const sampleIntervalMs = 30_000;
const driftType = 'consumption-pyramid';
const budgetType = 'auditor-budget-exceeded';
const outputType = 'senior-tool-output-share';
export const gateBoundary = event => event.type === 'gate-completed' ||
  event.type === 'auditor-rotation-proposed' && event.id?.startsWith('gate:');

export function rotationReason(policy, role, { gate, inputTokens, contextWindow, percent, compactions }) {
  const config = policy.roles?.[role] ?? {};
  if (compactions > 0 && Number.isFinite(percent) && 100 - percent < 100 * config.minRemainingAfterCompaction) {
    return 'post-compaction';
  }
  if (contextWindow > 0 && Number.isFinite(inputTokens) && inputTokens / contextWindow >= config.maxContextFraction) {
    return 'context-window';
  }
  if (inputTokens > config.maxContextTokens) return 'context-limit';
  if (compactions >= config.rotateAtCompactions) return 'compaction';
  if (gate && config.rotateAt === 'gate') return 'gate';
}

export function roleBudget(project, { now, sessions, notifications, batchDeliveryId, report, signalRotation, observeRotation, policyV2 }) {
  const sampled = new Map();
  const boundaries = new Map();
  const pyramids = new Map();
  const nativeContexts = new Map();
  const artifacts = readArtifacts(project);

  function assessAuditor(rows, reader, boundary) {
    const wakes = new Set();
    for (const row of rows) {
      if (row.endedAt != null && row.endedAt <= boundary) continue;
      try {
        const history = reader.sessionHistory(row);
        const { items, path } = history;
        for (const { turn, journalOnly } of items) {
          const startedAt = timestamp(turn.startedAt);
          if (startedAt >= row.startedAt && startedAt > boundary) {
            wakes.add(JSON.stringify([!journalOnly && path ? path : row.addr, turn.id ?? startedAt, startedAt]));
          }
        }
      } catch (error) { report(`Auditor budget ${row.addr}: ${error.message}`); }
    }
    return wakes.size;
  }

  function readContext(row, reader, snapshot) {
    const { items, raw } = reader.sessionHistory(row);
    return sessionContext(row, { items, raw: raw.map(item => item.row) }, {
      snapshot: { ...snapshot, contextUsage: snapshot?.contextUsage ?? sessions.runtimeContext(row.addr) }, events: rootEvents(row, sessions.events(row.addr)), statusline: artifacts.context(row.addr),
    });
  }

  async function assessRotation(name, row, reader, gateBoundaryEvent, policy, at, safe) {
    if (!row) return;
    const snapshot = await sessions.transport.inspect(sessions.targetBinding(row)).catch(() => undefined);
    const usage = readContext(row, reader, snapshot);
    nativeContexts.set(row.addr, usage);
    if (policyV2?.()) return observeRotation(row, usage, snapshot, safe);
    if (!safe || snapshot?.state !== 'idle' || snapshot.active || snapshot.userPrompt) return;
    const gate = gateBoundaryEvent?.at >= row.startedAt ? gateBoundaryEvent.gate : undefined;
    const reason = rotationReason(policy, row.role, { gate, ...usage });
    if (!reason || !signalRotation?.(row, reason)) return;
    notifications.add({ id: `${row.role}-rotation:` + batchDeliveryId(name, row.addr), project: name, at, addr: row.addr,
      role: row.role, type: `${row.role}-rotation-proposed`, ...(gate && { gate }), usage, reason, logOnly: true,
      text: `${row.role} 到达换班边界（${reason}），将在下一次现有投递收到提示。` });
  }

  function assessToolOutput(name, rows, reader, events, at) {
    const boundary = at - pyramidWindowMs;
    for (const role of ['leader', 'auditor']) {
      if (events.some(event => event.type === outputType && event.role === role && event.at > boundary)) continue;
      const output = [];
      let growth = 0;
      for (const row of rows.filter(row => row.role === role && (row.endedAt ?? at) > boundary)) {
        const { items, raw } = reader.sessionHistory(row);
        let prior;
        for (const { turn, rows: turnRows } of items) {
          if (timestamp(turn.endedAt) < boundary) {
            prior = turn.calls?.at(-1)?.inputTokens ?? prior;
            continue;
          }
          for (const call of turn.calls ?? []) {
            if (Number.isFinite(prior) && Number.isFinite(call.inputTokens)) growth += Math.max(0, call.inputTokens - prior);
            prior = call.inputTokens ?? prior;
          }
          if (row.cli !== 'agy') for (const tool of turnTools(row.cli, turn, turnRows)) {
            if (tool.output) output.push({ category: seniorOutputCategory(tool.name, tool.command ?? ''), text: tool.output });
          }
        }
        if (row.cli === 'agy') output.push(...agyToolOutput(raw.map(item => item.row), row.cwd, project, { classifyGuard: false }).output
          .filter(item => item.source === 'tool' && item.at > boundary && item.at <= at));
      }
      const categories = sumOutputTokens(output);
      const toolTokens = Object.values(categories).reduce((sum, current) => sum + current, 0);
      const share = Math.min(1, toolTokens / growth);
      if (growth >= 5000 && share > 0.35) notifications.add({ id: `${outputType}:${batchDeliveryId(name, role + at)}`,
        type: outputType, project: name, role, at, categories, toolTokens, contextGrowthTokens: growth, share,
        text: `${role} 最近一小时工具输出约占新增上下文的 ${Math.round(share * 100)}%，请检查分工或卡片设计。` });
    }
  }

  return {
    pyramid: name => pyramids.get(name),
    context: addr => nativeContexts.get(addr),
    freshContext: row => readContext(row, historyReader(project)),
    async check(name, rows, policy, { completeGate, safe, boundaryKey, leader, auditor, gateRecorded = false } = {}) {
      const at = now();
      const periodic = at - (sampled.get(name) ?? -Infinity) >= sampleIntervalMs;
      const configured = policyV2?.() || [leader, auditor].some(row => row &&
        ['rotateAt', 'maxContextTokens', 'maxContextFraction', 'minRemainingAfterCompaction', 'rotateAtCompactions']
          .some(key => policy.roles?.[row.role]?.[key] !== undefined));
      if (!safe) boundaries.delete(name);
      const newBoundary = configured && safe && boundaryKey !== undefined && boundaries.get(name) !== boundaryKey;
      if (!completeGate && !gateRecorded && !periodic && !newBoundary) return;
      for (const row of rows) if (row.endedAt != null) nativeContexts.delete(row.addr);
      const events = notifications.list(name, false, true);
      const gate = events.findLast(gateBoundary);
      const id = 'auditor-budget:' + batchDeliveryId(name, gate?.id ?? '');
      const reader = historyReader(project);
      if (!completeGate) for (const row of [leader, auditor]) await assessRotation(name, row, reader, gate, policy, at, safe);
      if (newBoundary) boundaries.set(name, boundaryKey);
      if (gateRecorded || !completeGate && !periodic) return;
      const prior = events.find(event => event.id === id);
      if (prior) {
        if (completeGate && !prior.gate) notifications.refresh(id, { gate: completeGate });
      } else {
        const wakes = assessAuditor(rows.filter(row => row.role === 'auditor'), reader, gate?.at ?? -Infinity);
        const maxWakesPerGate = policy.roles?.auditor?.maxWakesPerGate ?? 3;
        if (wakes > maxWakesPerGate) {
          const stamp = new Date(at).toISOString();
          notifications.add({ id, project: name, type: budgetType, at, role: 'auditor', addr: auditor?.addr,
            ...(completeGate && { gate: completeGate }), ...(gate && { afterGate: gate.gate }),
            text: `Auditor 本门禁唤醒 ${wakes}/${maxWakesPerGate}（采样 ${stamp}）。请检查派工节奏与门禁包，合并常规审查材料。`,
            usage: { wakes, maxWakesPerGate }, sampledAt: at, overBudget: true });
        }
      }
      if (completeGate) return;
      const lastDrift = events.findLast(event => event.type === driftType);
      const mayNotify = at - (lastDrift?.at ?? -Infinity) >= pyramidWindowMs;
      if (at - (pyramids.get(name)?.sampledAt ?? -Infinity) >= (mayNotify ? sampleIntervalMs : 60_000)) {
        const recent = rows.filter(row => row.endedAt == null || row.endedAt >= at - pyramidWindowMs);
        const { pyramid } = projectCost(project, recent, { now: at, includeAcceptance: false, reader, policy });
        pyramids.set(name, { ...pyramid, sampledAt: at });
        const ready = pyramidSampleReady(pyramid);
        if (ready) {
          try { assessToolOutput(name, rows, reader, events, at); }
          catch (error) { report(`Senior tool output ${name}: ${error.message}`); }
        }
        if (ready && mayNotify && pyramid.inversions.length) {
          const details = pyramid.inversions.map(({ metric, higher, lower, actual, comparedTo }) =>
            `${higher} > ${lower}（${metric} ${actual} > ${comparedTo}）`).join('；');
          notifications.add({ id: 'pyramid:' + batchDeliveryId(name, at), type: driftType, project: name, at,
            text: `最近一小时消耗金字塔倒置：${details}`, pyramid });
        }
      }
      sampled.set(name, at);
    },
  };
}
