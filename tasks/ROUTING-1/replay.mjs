import { readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { readArtifacts } from '../../cli/artifacts.mjs';
import { auditorWakeSource } from '../../daemon/routing.mjs';

// Open only durable Loom metadata. Native turn heads give the number of
// submissions, including repeated uses of one historical delivery ID.
const project = realpathSync(process.argv[2] ?? '/Users/sun/Code/loom-pilot2');
const artifacts = readArtifacts(project);
const jobs = readdirSync(join(project, '.project/loomd/sessions'))
  .flatMap(name => name.endsWith('.json') && !name.endsWith('.turn-heads.json') ?
    [artifacts.job(name.slice(0, -5))] : []).filter(job => job?.row);
const roles = new Map(jobs.map(job => [job.row.addr, job.row.role]));
const messages = new Map(artifacts.messages().map(message => [message.id, message]));
const totals = { completed: 0, kept: {}, filtered: {} };
const count = (group, key) => { group[key] = (group[key] ?? 0) + 1; };

for (const job of jobs.filter(job => job.row.role === 'auditor')) {
  for (const turn of artifacts.turnHeads(job.row.addr)) {
    if (!turn.endedAt) continue;
    totals.completed++;
    if (!turn.deliveryId) {
      count(totals.kept, 'native-user');
      continue;
    }
    const message = messages.get(turn.deliveryId);
    const source = message && auditorWakeSource(message, { startupId: job.firstId, handoverId: job.handoverReportId,
      senderRole: roles.get(message.from?.addr) });
    if (source) count(totals.kept, source);
    else if (!message) count(totals.filtered, 'unmatched');
    else {
      const provenance = [
        ['replyKey', 'auto-reply'], ['orgEvents', 'drift'], ['waveBatch', 'wave-copy'],
        ['reviewerResult', 'reviewer-result'], ['stuckOf', 'stuck'],
      ].find(([key]) => message[key]);
      count(totals.filtered, provenance?.[1] ?? 'ordinary-message');
    }
  }
}
console.log(JSON.stringify(totals, null, 2));
