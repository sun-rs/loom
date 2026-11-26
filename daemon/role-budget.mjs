import { projectCost, pyramidSampleReady, pyramidWindowMs } from '../cli/cost.mjs';
import { historyReader } from '../cli/history.mjs';
import { rotationLimits } from '../cli/policy.mjs';
import { nativeCallContext, reportedContext } from '../cli/state.mjs';
import { timestamp } from '../cli/turns.mjs';
import { turnTools } from '../lib/turn-tools.mjs';
import { agyToolOutput, seniorOutputCategory, sumOutputTokens } from '../lib/senior-tool-output.mjs';

const sampleIntervalMs = 30_000;
const driftType = 'consumption-pyramid';
const budgetType = 'auditor-budget-exceeded';
const outputType = 'senior-tool-output-share';
export const gateBoundary = event => ['gate-completed', 'auditor-rotation-proposed'].includes(event.type);

export function rotationReason(policy, role, { gate, contextTokens, wakes }) {
  const limits = rotationLimits(policy, role);
  if (contextTokens > limits.maxContextTokens || wakes > limits.maxWakesPerGate) return 'budget';
  if (gate && policy.roles?.[role]?.rotateAt === 'gate') return 'gate';
}

export function roleBudget(project, { now, sessions, notifications, batchDeliveryId, report, signalRotation }) {
  const sampled = new Map();
  const pyramids = new Map();
  const nativeContexts = new Map();

  async function context(row, { items, raw }, useLastCall) {
    const nativeInput = items.findLast(item => item.turn.calls?.length)?.turn.calls.at(-1)?.inputTokens;
    if (useLastCall && Number.isFinite(nativeInput)) return nativeInput;
    const snapshot = await sessions.transport.inspect(sessions.targetBinding(row)).catch(() => undefined);
    const events = sessions.events(row.addr).filter(event => !event.agent_id && !event.isSidechain &&
      (!row.sessionId || (event.session_id ?? event.sessionId ?? event.conversationId) === row.sessionId));
    return reportedContext(snapshot ?? {}, events, raw.map(({ row }) => row)).tokens ?? nativeInput ?? null;
  }

  async function assessAuditor(rows, reader, boundary, policy) {
    const wakes = new Set();
    const active = rows.findLast(row => row.endedAt === null && sessions.jobs.has(row.addr));
    let tokens = null;
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
        if (row === active) tokens = await context(row, history, false);
      } catch (error) { report(`Auditor budget ${row.addr}: ${error.message}`); }
    }
    return { wakes: wakes.size, contextTokens: tokens, ...rotationLimits(policy, 'auditor') };
  }

  async function proposeLeader(name, leader, reader, events, policy, at) {
    const id = 'leader-rotation:' + batchDeliveryId(name, leader.addr);
    const prior = events.find(event => event.id === id);
    if (prior) return signalRotation?.(leader, prior.reason);
    const gate = events.findLast(event => gateBoundary(event) && event.at >= leader.startedAt)?.gate;
    const contextTokens = await context(leader, reader.sessionHistory(leader), true);
    const usage = { contextTokens, ...rotationLimits(policy, 'leader') };
    const reason = rotationReason(policy, 'leader', { gate, ...usage });
    if (!reason) return;
    const why = reason === 'gate' ? `门禁 ${gate} 已完成，卡片已到安全边界。` :
      `Leader 最近调用的输入为 ${contextTokens} token，超过 ${usage.maxContextTokens}。`;
    notifications.add({ id, project: name, at, addr: leader.addr, type: 'leader-rotation-proposed',
      gate, usage, reason, logOnly: true, text: `${why} Leader 在下一次现有投递收到自助换班提示。` });
    signalRotation?.(leader, reason);
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
    nativeContext: addr => nativeContexts.get(addr),
    async check(name, rows, policy, { completeGate = false, safeLeader, leader, auditor, gateRecorded = false } = {}) {
      const at = now();
      if (!completeGate && !gateRecorded && at - (sampled.get(name) ?? -Infinity) < sampleIntervalMs) return;
      const events = notifications.list(name, false, true);
      const gate = events.findLast(gateBoundary);
      const id = 'auditor-budget:' + batchDeliveryId(name, gate?.id ?? '');
      const reader = historyReader(project);
      for (const row of rows) {
        if (!['leader', 'auditor'].includes(row.role)) continue;
        if (row.endedAt != null || !sessions.jobs.has(row.addr)) nativeContexts.delete(row.addr);
        else try {
          nativeContexts.set(row.addr, nativeCallContext(row, reader.sessionHistory(row), sessions.runtimeContext(row.addr)));
        } catch (error) { report(`Board context ${row.addr}: ${error.message}`); }
      }
      if (safeLeader) await proposeLeader(name, safeLeader, reader, events, policy, at);
      else if (leader) {
        const contextTokens = await context(leader, reader.sessionHistory(leader), true);
        if (contextTokens > rotationLimits(policy, 'leader').maxContextTokens) signalRotation?.(leader, 'budget');
      }
      if (gateRecorded) return;
      const usage = await assessAuditor(rows.filter(row => row.role === 'auditor'), reader, gate?.at ?? -Infinity, policy);
      const overBudget = Boolean(rotationReason(policy, 'auditor', usage));
      if (usage.contextTokens > usage.maxContextTokens) signalRotation?.(auditor, 'budget');
      const prior = events.find(event => event.id === id);
      if (overBudget || prior) {
        const context = usage.contextTokens == null ? '未知' : `${usage.contextTokens}/${usage.maxContextTokens}`;
        const stamp = new Date(at).toISOString();
        const action = overBudget ? ' 请把常规材料合并成一份门禁包。下次门禁完成时将建议换班。' : '';
        const text = `Auditor ${overBudget ? '超出预算' : '当前在预算内'}（采样 ${stamp}，本门禁唤醒 ${usage.wakes}/${usage.maxWakesPerGate}，上下文 token ${context}）。${action}`;
        const sample = { text, usage, sampledAt: at, overBudget };
        if (prior) notifications.refresh(id, sample);
        else notifications.add({ id, project: name, type: budgetType, at, logOnly: true, ...sample });
      }
      if (completeGate) return overBudget ? { usage, sampledAt: at } : undefined;
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
