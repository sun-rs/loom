import { readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { readArtifacts } from '../../cli/artifacts.mjs';
import { projectIndex } from '../../cli/project.mjs';
import { auditorWakeSource } from '../../daemon/routing.mjs';
import { pendingWork } from '../../inbox/engine.mjs';

const project = realpathSync(process.argv[2] ?? '/Users/sun/Code/loom-pilot2');
const artifacts = readArtifacts(project);
const jobs = readdirSync(join(project, '.project', 'loomd', 'sessions'))
  .filter(name => name.endsWith('.json') && !name.endsWith('.turn-heads.json'))
  .map(name => artifacts.job(name.slice(0, -5))).filter(job => job?.row);
const roles = new Map(jobs.map(job => [job.row.addr, job.row.role]));
const messages = new Map(artifacts.messages().map(message => [message.id, message]));
const job = jobs.find(job => job.row.role === 'auditor' && job.firstId.startsWith('37141563-'));
if (!job) throw new Error('Missing pilot-2 goal 3 Auditor');
const turns = artifacts.turnHeads(job.row.addr).filter(turn => turn.startedAt != null);
const indexOf = prefix => {
  const index = turns.findIndex(turn => turn.deliveryId?.startsWith(`${prefix}-`));
  if (index < 0) throw new Error(`Missing pilot-2 goal 3 turn ${prefix}`);
  return index;
};

const gates = [
  ['测试门禁第 1 轮', 'e00f36b9'], ['测试门禁第 2 轮', '1017c7d5'],
  ['合入门禁第 1 轮', '943d8f41'], ['合入门禁第 2 轮', '97f16e41'],
].map(([name, prefix]) => ({ name, index: indexOf(prefix) }));
const start = indexOf('37141563');
const end = indexOf('b9a175bc') + 1;

function replay(name, from, to, pack = false) {
  const group = turns.slice(from, to);
  const wakes = {};
  let reviewerRedirectedToLeader = 0;
  for (const [index, turn] of group.entries()) {
    let message = messages.get(turn.deliveryId);
    if (message?.reviewerResult) reviewerRedirectedToLeader++;
    // Historical Leader submissions predate gate pack. Replay each fixed
    // candidate as one packet pointer, with any reviewer evidence in the pack.
    if (pack && index === 0) message = { ...message, gatePacket: name };
    const source = !turn.deliveryId ? 'native-user' : message && auditorWakeSource(message, {
      startupId: job.firstId, handoverId: job.handoverReportId, senderRole: roles.get(message.from?.addr),
    });
    if (source) wakes[source] = (wakes[source] ?? 0) + 1;
  }
  return { name, historical: group.length, predicted: Object.values(wakes).reduce((sum, count) => sum + count, 0),
    wakes, reviewerRedirectedToLeader };
}

const results = [replay('首个门禁前', start, gates[0].index), ...gates.map(({ name, index }, i) =>
  replay(name, index, gates[i + 1]?.index ?? end, true))];
const stale = artifacts.messages().find(message => message.id.startsWith('5b58581e-'));
const ended = new Set(projectIndex(project).query().filter(row => row.endedAt != null).map(row => row.addr));
const pending = new Set(pendingWork([...messages.values()], undefined, undefined, addr => ended.has(addr))
  .pendingDeliveries.map(message => message.id));
console.log(JSON.stringify({ results, totals: { historical: end - start,
  predicted: results.reduce((sum, gate) => sum + gate.predicted, 0) },
  stale: stale && { delivery: stale.id, target: stale.target.addr, phase: stale.phase, issue: stale.issue,
    targetEnded: ended.has(stale.target.addr), remainsPending: pending.has(stale.id) } }, null, 2));
