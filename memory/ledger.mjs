import { createHash } from 'node:crypto';
import { numberedRulings } from '../handover/organization.mjs';

export const rulingPath = '.project/rulings.md';
export const eventMemoryId = identity => 'memory-event-' + createHash('sha256').update(identity).digest('hex');
const rulingId = (project, key) => eventMemoryId(JSON.stringify([project, project, 'ruling', null, key]));

export function ledgerRulings(project, text) {
  const preceding = new Map();
  const entries = [];
  const counts = new Map();
  for (const { number, continuation, quote } of numberedRulings(text, { continuations: true })) {
    const base = rulingId(project, number);
    const label = continuation ? `R${number} ${continuation}` : `R${number}`;
    const count = counts.get(label) ?? 0;
    counts.set(label, count + 1);
    const id = continuation || count ? rulingId(project, [number, continuation ?? '', count]) : base;
    const body = quote.map(line => line.replace(/^ {0,3}> ?/u, '')).join('\n');
    const title = Array.from(`R${number} ${body.split('\n', 1)[0].replace(/\s+/gu, ' ').trim()}`).slice(0, 150).join('');
    const replacements = continuation ? [] : Array.from(body.matchAll(
      /整条取代[ \t]+R(\d+)(?![\d①-⑳]|[ \t]*(?:中|的|第|款|项|条))/giu),
    match => preceding.get(match[1])).filter(Boolean);
    entries.push({ id, title, body, supersedes: [...new Set(replacements)],
      ...(continuation && { continuationOf: base }) });
    if (!continuation && !preceding.has(number)) preceding.set(number, base);
  }
  return entries;
}

export function isLegacyMechanicalMemory(project, entry) {
  const { id, role, kind, layer, title, source, original, proposer, reviewer } = entry;
  const { addr, turnId } = source?.hist ?? {};
  if (layer !== 'shared' || !entry.project || !addr || !turnId || original || proposer || reviewer ||
      !/^memory-event-[a-f\d]{64}$/u.test(id)) return false;
  const matches = (category, key) => id === eventMemoryId(JSON.stringify([project, entry.project, category, addr, key]));
  const numericTurnId = Number(turnId);
  const matchesTurn = category => matches(category, turnId) ||
    (Number.isSafeInteger(numericTurnId) && String(numericTurnId) === turnId && matches(category, numericTurnId));
  if (role === 'worker' && kind === 'lesson' && title?.startsWith('Card ')) return matchesTurn('card');
  if ((role === 'auditor' && kind === 'ruling' || role === 'leader' && kind === 'lesson') &&
      (title === role + ' handover' || title?.startsWith(role + ' handover '))) return matchesTurn('handover');
  const packet = /^\.project\/gates\/(.+)\.r(\d+)\.([^/]+)\.md$/u.exec(source.path ?? '');
  return Boolean(role === 'auditor' && kind === 'ruling' && packet &&
    [`Gate ${packet[1]} round ${packet[2]}`, `Escalation ${packet[1]} round ${packet[2]}`].includes(title) &&
    matches('gate', packet[3]));
}
