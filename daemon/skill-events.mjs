import { replyConclusion } from '../inbox/message.mjs';
import { redReasons } from './routing.mjs';

const escalations = new Set(['audit-escalation', 'blocked-escalation', 'red-escalation',
  'auditor-handover-failed', 'leader-handover-failed']);
const auditReasons = new Set(['blocking-disagreement', 'three-failed-rounds', 'audit-returns', 'major-risk', 'overreach', 'handover-failed']);
const recovery = new Set(['stuck', 'wave-timeout', 'worker-handoff']);
const deliveryIssues = new Set(['delivery-stalled', 'delivery-uncertain', 'uncertain-reply']);
const incidents = new Set(['fabrication', 'overreach', 'protected-file', 'sandbox-escape']);
const isReject = tag => tag === 'REJECT' || tag === 'REJECTED';
const isApproval = tag => ['PASS', 'PASSED', 'APPROVE', 'APPROVED'].includes(tag);

// Everything except an explicit REJECT conclusion comes from daemon receipts,
// the authenticated sender, or the native completion of an identified delivery.
export function deliverySkillEvents({ role, message, peers = [], notices = [], observed = [],
  requestFor, senderRole, resultTags, integrated, workerDenied, senderStalls }) {
  const related = [message, ...peers];
  const requests = related.map(requestFor).filter(Boolean);
  const verdicts = requests.filter(item => item.gatePacket).map(item => replyConclusion(item.completion?.body).tag);
  const evidence = [...notices, ...observed];
  const hasDecision = evidence.some(item => item.type === 'needs-decision' || item.type === 'blocked-escalation');
  const names = [];
  if (message.rotationActivation || message.handoverWorkReminder) names.push('rotation-activation');
  if (message.rotationVerifier) names.push('rotation-verify');

  if (role === 'super') {
    if (hasDecision) names.push('needs-decision');
    if (evidence.some(item => escalations.has(item.type) || auditReasons.has(item.reason) || redReasons.has(item.reason))) names.push('escalation');
    if (senderStalls || related.some(item => item.uncertainOf || item.corruptedOf) || evidence.some(item =>
      deliveryIssues.has(item.type) || ['payload-mismatch', 'holder-partial-write'].includes(item.reason))) names.push('delivery-uncertain');
    if (evidence.some(item => item.type?.startsWith('host-tier-') || item.kind === 'worker-tier-request')) names.push('host-tier');
    if (evidence.some(item => item.type === 'project-completed')) names.push('close');
    return { names, gateRejection: false };
  }

  if (role === 'worker') {
    if (workerDenied) names.push('worker-denied');
    if (message.workerResume) names.push('worker-resume');
    return { names, gateRejection: false };
  }

  if (!['leader', 'auditor'].includes(role)) return { names, gateRejection: false };
  const tags = [...resultTags, ...requests.map(item => replyConclusion(item.completion?.body).tag)];
  if (related.some(item => item.waveKind === 'blocked' || item.continuationKind === 'blocked') ||
      tags.includes('BLOCKED') || hasDecision) names.push('needs-decision');
  if (related.some(item => item.waveKind === 'timeout' || item.continuationKind === 'timeout' || item.stuckOf || item.workerResultsFailed) ||
      tags.includes('FAILED') || evidence.some(item => recovery.has(item.type) ||
        item.reason === 'handover-work-unstarted')) names.push('senior-recovery');
  if (related.some(item => incidents.has(item.redEscalation)) || evidence.some(item =>
    incidents.has(item.kind) || incidents.has(item.reason) || item.type === 'fence-hit')) names.push('containment');

  const directReject = item => !item.replyTo && senderRole(item) === 'auditor' &&
    (isReject(replyConclusion(item.text).tag) || item.requestedMode === 'interrupt');
  const current = requestFor(message);
  const gateRejection = role === 'leader' && Boolean(current?.gatePacket && isReject(replyConclusion(current.completion?.body).tag));
  if (role === 'leader') {
    if (verdicts.some(isReject) || related.some(directReject)) names.push('reject-routing');
    if (verdicts.some(isApproval) || integrated) names.push('gate-pack');
  } else if (related.some(item => item.gatePacket)) names.push('gate-judgment');
  return { names, gateRejection };
}
