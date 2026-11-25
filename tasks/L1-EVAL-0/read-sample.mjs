import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { history, historyReader } from '../../cli/history.mjs';
import { adapterFor, readTranscript, transcriptFor } from '../../cli/sessions.mjs';
import { transcriptRows } from '../../cli/turns.mjs';
import { openIndex } from '../../index/index.mjs';
import { digestText, nativeDigests, oarDigests } from './activity-digest.mjs';

const root = '/Users/sun/Code/exp-relay';
const run = join(root, 'runs/20261124165640-99591');
const runtime = join(root, 'claude-tui-rt-0');
const indexedProject = join(root, 'loom-cli-0/verified');
const loom = fileURLToPath(new URL('../../bin/loom', import.meta.url));
const exec = promisify(execFile);
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const pretty = value => JSON.stringify(value, null, 2);

const samples = {
  'codex-h0-t1': { worker: 'h0/T1', final: [104], focus: 1, grep: 'test/codex.test.mjs', outcome: 'quota', cmd: '^/bin/zsh -lc node --test test/codex\\.test\\.mjs$', tail: 6 },
  'codex-h1-t2': { worker: 'h1/T2', final: [105], focus: 1, outcome: 'failed', cmd: '^/bin/zsh -lc git status', tail: 4 },
  'codex-orca-t2': { worker: 'orca/T2', final: [94], focus: 1, grep: 'no such file or directory', outcome: 'failed', cmd: '^/bin/zsh -lc (ls -d lib test|node --test test/claude)', tail: 6 },
  'agy-h0-t3': { worker: 'h0/T3', final: [15], focus: 1, cmd: '^node --test', tail: 10 },
  'agy-h1-t4': { worker: 'h1/T4', final: [54], focus: 1, cmd: '^node --test', tail: 10 },
  'agy-orca-t4': { worker: 'orca/T4', final: [54], focus: 1, outcome: 'quota', cmd: '^node --test', tail: 10 },
  'claude-runtime-probe': { profile: 'probe-profile', workspace: 'probe', id: '829f3da3-2283-4895-851c-c595760ce84b', final: [25, 47, null], abort: { 3: 55 }, focus: 3, outcome: 'aborted', cmd: '^sleep', tail: 2 },
  'claude-runtime-final': { profile: 'live-profile', workspace: 'workspace-final', id: '5280d77a-8960-4c04-bf13-7099c8fe1395', final: [25, 36, null, 58, 73], abort: { 3: 52 }, focus: 3, outcome: 'aborted', cmd: '^sleep', tail: 2 },
  'claude-loom-cli': { indexed: 'loom-7b8bb2ae-3c33-48cf-a6f1-af5f50906797', wave: 'W-SMOKE', final: [47, 55, 62], focus: 1, cmd: 'spawn worker', tail: 1 },
  'oar-headless-codex': { indexed: 'oar-9129d4ab-ee5b-4347-ade1-6c767161ba0e', headless: true, final: [22], focus: 1, cmd: 'node --test', tail: 6 },
};

function sourceFor(sample) {
  if (sample.worker) {
    const source = join(run, 'sessions.json');
    const row = json(source).sessions.find(item => item.role === 'worker' &&
      `${item.arm}/${item.task}` === sample.worker);
    if (!row) throw new Error(`Missing worker ${sample.worker}`);
    return { source, addr: row.worker, cli: row.provider, sessionId: row.session_id, transcriptPath: row.path,
      cwd: row.cwd, project: row.cwd, endedAt: null };
  }
  if (sample.indexed) {
    const source = join(indexedProject, '.project/index.sqlite');
    const [row] = openIndex(source).query({ addr: sample.indexed, backend: sample.headless ? 'headless' : 'tui' });
    if (!row) throw new Error(`Missing indexed session ${sample.indexed}`);
    return { ...row, source };
  }
  const project = join(runtime, sample.workspace);
  const slug = project.replaceAll('/', '-');
  const path = join(runtime, sample.profile, 'projects', slug, `${sample.id}.jsonl`);
  return { source: path, addr: sample.id, sessionId: sample.id, cli: 'claude', cwd: project,
    project, transcriptPath: path, endedAt: null };
}

function rawReplies(sample, provider, rows, nativeTurns) {
  if (nativeTurns.length !== sample.final.length) throw new Error('Native turn count changed');
  const bodies = [];
  const sections = sample.final.map((line, i) => {
    const row = rows.get(line ?? sample.abort[i + 1]);
    const heading = `#### Turn ${i + 1}`;
    if (!line) {
      const marker = row?.message?.content?.find(block => block.type === 'text' &&
        block.text.startsWith('[Request interrupted by user'))?.text;
      if (!marker || nativeTurns[i].status !== 'interrupted') throw new Error(`Expected native interruption in turn ${i + 1}`);
      return `${heading}\n\nNative line ${sample.abort[i + 1]} records ${JSON.stringify(marker)}. No final reply.`;
    }
    let reply;
    if (provider === 'codex' && row?.payload?.phase === 'final_answer') {
      reply = row.payload.content.map(part => part.text).join('');
    } else if (provider === 'agy' && row?.type === 'PLANNER_RESPONSE' && row.status === 'DONE') {
      reply = row.content;
    } else if (provider === 'claude' && row?.type === 'assistant' && row.message?.stop_reason === 'end_turn') {
      reply = row.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    }
    if (!reply) throw new Error(`Missing native final reply at line ${line}`);
    bodies.push(reply);
    return `${heading} · native line ${line}\n\n${block(reply)}`;
  });
  return { sections, bodies: bodies.join('\n\n') };
}

function block(value, language = 'text') {
  const fence = '~'.repeat(Math.max(3, ...Array.from(value.matchAll(/~+/g), match => match[0].length + 1)));
  return `${fence}${language}\n${value}\n${fence}`;
}

function l1Text(session, turns) {
  return [`${session.addr} L1`, ...turns.map(turn => `\n${turn.summary}\n` +
    `原件 ${turn.transcriptPath}${turn.startLine ? `:${turn.startLine}` : ''}`)].join('\n');
}

async function loomHist(session, args) {
  const { stdout } = await exec(loom, ['hist', ...args, '--project', session.project], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trimEnd();
}

function size(label, value, total) {
  const bytes = Buffer.byteLength(value);
  return `| ${label} | ${bytes} | ${Math.ceil(bytes / 4)} | ${(100 * bytes / total).toFixed(2)}% |`;
}

async function build(name) {
  const sample = samples[name];
  const session = sourceFor(sample);
  const path = transcriptFor(session);
  const raw = readTranscript(path);
  const rows = new Map(transcriptRows(raw).map(({ number, row }) => [number, row]));
  session.baseCommit ??= rows.get(1)?.payload?.git?.commit_hash ?? null;
  const native = adapterFor(session).transcript.parse(raw);
  const { sections, bodies } = rawReplies(sample, session.cli, rows, native.turns);

  const options = { level: 'L2', count: 1, exact: sample.focus, exactAddr: session.addr, tool: 'shell',
    command: new RegExp(sample.cmd), tail: sample.tail, outcome: sample.outcome, grep: sample.grep };
  const filters = ['--turn', String(sample.focus), '--tool', 'shell', '--cmd', sample.cmd, '--tail', String(sample.tail)];
  if (sample.outcome) filters.push('--outcome', sample.outcome);
  if (sample.grep) filters.push('--grep', sample.grep);
  const reader = historyReader(session.project);
  const read = overrides => history([session], reader, { ...options, ...overrides });
  const plain = { tool: undefined, command: undefined, outcome: undefined, grep: undefined };
  const { turns: all, missing } = await read({ ...plain, exact: undefined, exactAddr: undefined, count: Infinity,
    level: 'L1', showDiff: true, evidence: true });
  if (missing || all.length !== native.turns.length) throw new Error(`Unexpected history for ${name}`);
  const { turns: [focus] } = sample.indexed ? JSON.parse(await loomHist(session, [session.addr, ...filters, '--json'])) : await read({});
  if (!focus || !focus.tools.length) throw new Error(`L2 selection has no matching tool for ${name}`);

  const l1 = sample.indexed ? await loomHist(session, [session.addr, '--level', 'L1', '--turns', String(all.length)]) : l1Text(session, all);
  const digest = digestText(nativeDigests(session.cli, raw, session.cwd, native));
  const journal = sample.headless ? join(session.project, '.project', 'relay', 'events', `${session.addr}.jsonl`) : null;
  const projected = journal ? digestText(oarDigests(readTranscript(transcriptFor({ ...session, transcriptPath: journal })), session.cwd)) : null;
  const l2 = pretty(focus);
  const diffs = all.map(turn => pretty(turn.diff)).join('\n\n');
  const cardText = cards => cards.map(card => `${card.path}\n${card.summary ?? ''}`).join('\n\n');
  const ownCards = all.flatMap(turn => turn.evidence);
  const wave = sample.wave && JSON.parse(await loomHist(session, ['--wave', sample.wave, '--evidence', '--json'])).waves
    .find(wave => wave.parent === session.addr);
  const waveCards = wave?.members.flatMap(member => member.evidence ?? []) ?? [];
  const cards = cardText([...ownCards, ...waveCards]);
  const coordination = sample.worker?.startsWith('orca/') && json(join(run, 'orca.evidence.json')).messages
    .find(message => message.type === 'worker_done' && message.payload?.dispatchId === session.addr);
  const receipt = coordination ? pretty(coordination) : '';
  const total = Buffer.byteLength(raw);
  const sizes = [size('Native transcript', raw, total), size('Native final replies', bodies, total),
    size('L1 with fact rows', l1, total), size('Activity digest', digest, total), size('Filtered L2', l2, total), size('Diff output', diffs, total),
    cards ? size('Loom evidence cards', cards, total) : '| Loom evidence cards | — | — | — |',
    ...(projected ? [size('OAR journal activity digest', projected, total)] : []),
    ...(receipt ? [size('Orca completion receipt', receipt, total)] : [])];
  const commandLine = filters.map(value => /^[-\w/]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`).join(' ');

  return [
    `# ${name}`, `Native ID \`${session.sessionId}\` · ${session.cli} · ${all.length} turns`,
    `Source ${session.source === path ? 'native TUI transcript' : `\`${session.source}\``}\n\nTranscript \`${path}\`\n\nWorking directory \`${session.cwd}\``,
    `| View | UTF-8 bytes | Approx. tokens | Share of transcript |\n| --- | ---: | ---: | ---: |\n${sizes.join('\n')}`,
    'Approximate tokens are UTF-8 bytes divided by four, rounded up. Counts cover payloads only.',
    '## A. Native final replies', ...sections,
    `## B. Loom hist L1\n\n${sample.indexed ? 'Indexed CLI output.' : 'Read-only replay through Loom’s history reader and native adapter.'}\n\n${block(l1)}`,
    `### Activity digest\n\n${block(digest)}`,
    ...(projected ? [`#### OAR relay journal only\n\nSource \`${journal}\`\n\n${block(projected)}`] : []),
    `## C. Filtered L2 · turn ${sample.focus}\n\nFilters \`${commandLine}\`\n\n${block(l2, 'json')}`,
    `## D. Diff output\n\n${all.map(turn => `#### Turn ${turn.index}\n\n${block(pretty(turn.diff), 'json')}`).join('\n\n')}`,
    '## E. Evidence',
    ownCards.length ? block(cardText(ownCards)) : 'No Loom evidence card is attached to this session’s own turns.',
    ...(waveCards.length ? [`The coordinator received delivery \`${wave.destinations.find(item => item.to === session.addr).deliveryId}\` for wave \`${sample.wave}\`. The wave supplies these worker evidence cards.\n\n${block(cardText(waveCards))}`] : []),
    ...(receipt ? [`Orca recorded this \`worker_done\` message in \`${join(run, 'orca.evidence.json')}\` for the matching dispatch.\n\n${block(receipt, 'json')}`] : []),
  ].join('\n\n') + '\n';
}

const [name, ...extra] = process.argv.slice(2);
if (extra.length || !Object.hasOwn(samples, name)) {
  console.error(`Usage: node tasks/L1-EVAL-0/read-sample.mjs <${Object.keys(samples).join('|')}>`);
  process.exitCode = 2;
} else {
  process.stdout.write(await build(name));
}
