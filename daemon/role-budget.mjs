import { projectCost, pyramidWindowMs } from '../cli/cost.mjs';
import { historyReader } from '../cli/history.mjs';
import { auditorLimits } from '../cli/policy.mjs';
import { reportedContext } from '../cli/state.mjs';
import { timestamp } from '../cli/turns.mjs';

const sampleIntervalMs = 30_000;
const driftType = 'consumption-pyramid';
const budgetType = 'auditor-budget-exceeded';

export function roleBudget(project, { now, sessions, notifications, batchDeliveryId, tellLeader, report }) {
  const sampled = new Map();

  async function assessAuditor(rows, reader, boundary, policy) {
    const limits = auditorLimits(policy);
    const wakes = new Set();
    const active = rows.findLast(row => row.endedAt === null && sessions.jobs.has(row.addr));
    let tokens = null;
    for (const row of rows) {
      if (row.endedAt != null && row.endedAt <= boundary) continue;
      try {
        const { items, raw, path } = reader.sessionHistory(row);
        for (const { turn, journalOnly } of items) {
          const startedAt = timestamp(turn.startedAt);
          if (startedAt >= row.startedAt && startedAt > boundary) {
            wakes.add(JSON.stringify([!journalOnly && path ? path : row.addr, turn.id ?? startedAt, startedAt]));
          }
        }
        if (row === active) {
          const snapshot = await sessions.transport.inspect(sessions.targetBinding(row)).catch(() => undefined);
          const events = sessions.events(row.addr).filter(event => !event.agent_id && !event.isSidechain &&
            (!row.sessionId || (event.session_id ?? event.sessionId ?? event.conversationId) === row.sessionId));
          const nativeInput = items.findLast(item => item.turn.calls?.length)?.turn.calls.at(-1)?.inputTokens;
          tokens = reportedContext(snapshot ?? {}, events, raw.map(({ row }) => row)).tokens ?? nativeInput ?? null;
        }
      } catch (error) { report(`Auditor budget ${row.addr}: ${error.message}`); }
    }
    if (wakes.size <= limits.maxWakesPerGate && !(tokens > limits.maxContextTokens)) return;
    return { wakes: wakes.size, contextTokens: tokens, ...limits };
  }

  return {
    async check(name, rows, policy, { completeGate = false } = {}) {
      const at = now();
      if (!completeGate && at - (sampled.get(name) ?? -Infinity) < sampleIntervalMs) return;
      const events = notifications.list(name, false, true);
      const gate = events.findLast(event => event.type === 'gate-completed' || event.type === 'auditor-rotation-proposed');
      const id = 'auditor-budget:' + batchDeliveryId(name, gate?.id ?? '');
      const reader = historyReader(project);
      let over = events.find(event => event.id === id);
      if (!over) {
        const usage = await assessAuditor(rows.filter(row => row.role === 'auditor'), reader, gate?.at ?? -Infinity, policy);
        if (usage) {
          const context = usage.contextTokens == null ? '未知' : `${usage.contextTokens}/${usage.maxContextTokens}`;
          const text = `Auditor 超出预算（本门禁唤醒 ${usage.wakes}/${usage.maxWakesPerGate}，上下文 token ${context}）。请把常规材料合并成一份门禁包；下次门禁完成时将建议换班。`;
          over = { id, project: name, type: budgetType, at, text, usage, logOnly: true };
          notifications.add(over);
        }
      }
      if (over) {
        const leader = rows.findLast(row => row.role === 'leader' && row.endedAt === null && sessions.jobs.has(row.addr));
        if (leader) tellLeader(leader, over.text, batchDeliveryId(id, 'leader'));
      }
      if (completeGate) return over?.usage;
      const lastDrift = events.findLast(event => event.type === driftType);
      if (at - (lastDrift?.at ?? -Infinity) >= pyramidWindowMs) {
        const recent = rows.filter(row => row.endedAt == null || row.endedAt >= at - pyramidWindowMs);
        const { pyramid } = projectCost(project, recent, { now: at, includeAcceptance: false, reader, policy });
        if (pyramid.inversions.length) {
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
