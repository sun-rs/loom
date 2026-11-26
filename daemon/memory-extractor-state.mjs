import { join } from 'node:path';
import { runtimeDirectory } from '../cli/project.mjs';
import { readText } from './io.mjs';

export const extractorDay = now => new Date(now).toISOString().slice(0, 10);
export const extractorStatePath = project => join(runtimeDirectory(project), 'memory-extractor.json');
export function readExtractorState(project) {
  return JSON.parse(readText(extractorStatePath(project), 'null')) ?? {
    turns: {}, boundaries: {}, proposals: {}, days: {},
  };
}

export function extractorMetrics(project, now = Date.now()) {
  const { days, proposals } = readExtractorState(project);
  const totals = Object.values(days).reduce((sum, day) => ({
    calls: sum.calls + day.calls, tokens: sum.tokens + day.tokens,
    stageCalls: sum.stageCalls + day.stageCalls, stageTokens: sum.stageTokens + day.stageTokens,
  }), { calls: 0, tokens: 0, stageCalls: 0, stageTokens: 0 });
  const entries = Object.values(proposals);
  const approved = entries.filter(item => item.status === 'approved').length;
  const rejected = entries.filter(item => item.status === 'rejected').length;
  const { charged, calls, stageCalls, stopReason } = days[extractorDay(now)] ?? {};
  return { ...totals, today: { calls: (calls ?? 0) + (stageCalls ?? 0), chargedTokens: charged ?? 0 },
    stopReason: stopReason ?? null, pendingProposals: entries.length - approved - rejected,
    proposalPassRate: approved + rejected ? approved / (approved + rejected) : null };
}
