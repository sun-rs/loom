import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectIndex } from '../../cli/project.mjs';
import { rotationReason } from '../../daemon/role-budget.mjs';
import { agyToolOutput } from '../../lib/senior-tool-output.mjs';
import { estimateTokens } from '../../lib/token-budget.mjs';
import { seniorShellCategory, shellCommands } from '../../lib/senior-tool-guard.mjs';

const project = resolve(process.argv[2] ?? '/Users/sun/Code/loom-pilot2');
const loom = fileURLToPath(new URL('../../bin/loom', import.meta.url));
const { turns } = JSON.parse(execFileSync(loom, ['hist', '--role', 'leader', '--project', project, '--level', 'L2',
  '--with-calls', '--turns', '500', '--json'], { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024,
  env: { ...process.env, LOOM_PROJECT: '', LOOM_ADDR: '', HC_TERMINAL_ID: '' } }));
const history = turns.filter(turn => turn.addr.startsWith('loom-8d74a63c') && turn.index <= 74);
const goal = history.filter(turn => turn.index >= 46);
if (history.length !== 74 || goal.length !== 29) throw new Error('Pilot-2 goal 4 Leader history is incomplete');
const raw = readFileSync(history[0].transcriptPath, 'utf8').trimEnd().split('\n').slice(0, history.at(-1).endLine).map(JSON.parse);
const observed = agyToolOutput(raw, project, project);
const groups = Object.groupBy(observed.output, item => item.category);
const chars = observed.output.reduce((sum, item) => sum + item.text.length, 0);
const sameCategories = Object.fromEntries(Object.entries(groups).map(([category, items]) => {
  const characters = items.reduce((sum, item) => sum + item.text.length, 0);
  return [category, { records: items.length, characters, share: characters / chars,
    deniedRecords: items.filter(item => item.denied).length }];
}));
const callCategories = Object.fromEntries(Object.entries(Object.groupBy(observed.calls, item => item.category))
  .map(([category, items]) => [category, { calls: items.length, denied: items.filter(item => item.denied).length,
    deniedSteps: items.filter(item => item.denied).map(item => item.step) }]));
const shellOperations = observed.calls.flatMap(({ step, cmd }) => (shellCommands(cmd.replace(/\\\n/g, ' ')) ?? [])
  .filter(([binary]) => binary === 'git').map(words => ({ step, category: seniorShellCategory(words.join(' '), project, project) })));
const gitIntegrationSteps = shellOperations.filter(item => item.category === 'git-integration').map(item => item.step);

const gates = [
  { name: 'G4-TESTS', from: 46, through: 61, packet: 'G4-TESTS-R2.' },
  { name: 'G4-MERGE', from: 62, through: 74, packet: 'G4-MERGED.' },
];
const readCommand = /(?:^|[|;&\n])\s*(?:cat|sed|head|tail|wc)\s/m;
const searchCommand = /(?:^|[|;&\n])\s*(?:rg|grep|find)\s/m;
const perGate = gates.map(({ name, from, through }) => {
  const tools = goal.filter(turn => from <= turn.index && turn.index <= through).flatMap(turn => turn.tools);
  return { gate: name, reads: tools.filter(tool => /read_file|outline/.test(tool.name) || readCommand.test(tool.command ?? '')).length,
    searches: tools.filter(tool => /search|grep/.test(tool.name) || searchCommand.test(tool.command ?? '')).length,
    tests: tools.filter(tool => observed.calls.some(call => call.category === 'test-build' && call.cmd && call.cmd === tool.command)).length };
});

const metadata = join(project, '.project');
const { messages } = JSON.parse(readFileSync(join(metadata, 'inbox', 'state.json'), 'utf8'));
const temporary = new Map(projectIndex(project).query().filter(row => ['worker', 'reviewer'].includes(row.role)).map(row => [row.addr, row]));
const busy = messages.filter(message => temporary.has(message.target?.addr)).map(message => {
  const row = temporary.get(message.target.addr);
  return [message.createdAt, message.completion?.at ?? message.refusedAt ?? row.endedAt ?? Infinity];
});
const boundaries = gates.map(({ name, packet }) => ({ name, at: messages.find(message =>
  message.gatePacket?.split('/').at(-1).startsWith(packet))?.completion?.at }));
if (boundaries.some(gate => !Number.isFinite(gate.at))) throw new Error('Pilot gate completion evidence is incomplete');
const allCalls = history.flatMap(turn => turn.calls);
const bootstrap = history[0].calls;
const briefCost = bootstrap.reduce((sum, call) => sum + call.inputTokens + call.outputTokens, 0);
const briefContext = bootstrap.at(-1).inputTokens + bootstrap.at(-1).outputTokens;
const append = (amount, item) => amount + estimateTokens(item.text);
const removedBefore = (call, guard) => guard ? observed.output.filter(item => item.denied && item.step < Number(call.id)).reduce(append, 0) : 0;
const delegated = observed.output.filter(item => item.denied);

function replay(policy, guard) {
  let previous = history[44].calls.at(-1);
  let prefix = 0;
  let lastRotation = Date.parse(history[44].endedAt);
  let maximum = 0;
  let context = previous.inputTokens - removedBefore(previous, guard);
  let cost = 0;
  const briefingTurns = [];
  for (const turn of goal) {
    const at = Date.parse(turn.startedAt);
    const gate = boundaries.findLast(item => lastRotation < item.at && item.at <= at);
    const safe = !busy.some(([start, end]) => start <= at && at < end);
    const reason = policy && safe && rotationReason(policy, 'leader', { inputTokens: context, gate: gate?.name });
    if (reason) {
      prefix = Math.max(0, previous.inputTokens - removedBefore(previous, guard) - briefContext);
      lastRotation = at;
      briefingTurns.push({ beforeTurn: turn.index, reason, gate: gate?.name, rawTokens: briefCost });
      cost += briefCost;
    }
    for (const call of turn.calls) {
      context = Math.max(bootstrap[0].inputTokens, call.inputTokens - removedBefore(call, guard) - prefix);
      maximum = Math.max(maximum, context);
      cost += context + call.outputTokens;
      previous = call;
    }
  }
  return { rawTokens: cost, maxInputTokens: maximum, finalInputTokens: context, briefingTurns };
}

const scenarios = {
  historical: replay(null, false),
  guardOnly: replay(null, true),
  gateOnly: replay({ roles: { leader: { rotateAt: 'gate', maxContextTokens: Number.MAX_SAFE_INTEGER } } }, false),
  defaultRotation: replay({ roles: { leader: { maxContextTokens: 150_000 } } }, false),
  guardAndRotation: replay({ roles: { leader: { rotateAt: 'gate', maxContextTokens: 150_000 } } }, true),
};
for (const item of Object.values(scenarios)) item.savedRawTokens = scenarios.historical.rawTokens - item.rawTokens;
console.log(JSON.stringify({ goalTurns: goal.length, goalCalls: goal.flatMap(turn => turn.calls).length,
  baselineCalls: allCalls.length, transcriptRecords: raw.length, sameCategories, callCategories, gitIntegrationSteps,
  perGate, briefCost, briefContext, removedToolOutputEstimate: delegated.reduce(append, 0), scenarios }, null, 2));
