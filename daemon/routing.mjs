import { assertionCounts } from '../evidence/git.mjs';

export const redReasons = new Set(['protected-file', 'assertion', 'skip-only', 'confirmed-fact-miss', 'sandbox-escape']);
export const auditEscalations = new Set(['blocking-disagreement', 'three-failed-rounds', 'major-risk', 'overreach']);
export const auditorWakeFiltered = 'auditor-wake-filtered';

// A restored queue can predate ROUTING-1. Recognize its user and succession
// records by provenance, never by matching natural-language prompt text.
export function auditorWakeSource(message, { startupId, handoverId, senderRole, deepReview = false } = {}) {
  if (message.startup && startupId && startupId === message.id || handoverId && message.id === handoverId) return 'succession';
  if (message.gatePacket) return message.redEscalation ? 'escalation' : 'gate';
  if (message.reviewerResult && deepReview) return 'deep-review';
  if (message.replyKey || message.replyTo || message.waveBatch || message.continuationBatch ||
      message.reviewerResult || message.stuckOf || message.watchResume || message.corruptedOf ||
      message.uncertainOf || message.projectEvents || message.orgEvents && !message.orgAppendix) return;
  if (message.userWake || message.superPriority && (!message.from || senderRole === 'super')) return 'user';
}

export function workerRedFacts(git) {
  return [
    ...(git?.protectedHits ?? []).map(hit => ({ reason: 'protected-file', file: hit.path })),
    ...(git?.scopeHits ?? []).map(file => ({ reason: 'protected-file', file })),
    ...(git?.tests ?? []).flatMap(test => [
      assertionCounts(test).removedAssertions > 0 &&
        { reason: 'assertion', file: test.path },
      (test.changes?.addedSkip > 0 || test.changes?.addedOnly > 0) && { reason: 'skip-only', file: test.path },
    ].filter(Boolean)),
  ];
}
