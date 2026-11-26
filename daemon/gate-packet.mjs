import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readArtifacts } from '../cli/artifacts.mjs';
import { CommandError } from '../cli/sessions.mjs';
import { clip } from '../evidence/checks.mjs';
import { writeState } from './io.mjs';
import { workerRedFacts } from './routing.mjs';
import { conclusoryReply } from '../inbox/message.mjs';

export const gateId = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const oneLine = text => String(text ?? '').replace(/\s+/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim();
const bullet = (lines, empty) => lines.length ? lines.join('\n') : empty;

function git(project, ...args) {
  const result = spawnSync('git', ['--no-pager', ...args], {
    cwd: project, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function commit(project, ref) {
  return git(project, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
}

export function saveGatePacket(project, { id, gate, round, base: baseRef, candidate: candidateRef = 'HEAD', question },
  { members, jobs, messages, decisions, signalSummary, signalCount, red, memoryProposals }) {
  const baseDirectory = join(project, '.project');
  const directory = join(baseDirectory, 'gates');
  if (realpathSync(baseDirectory) !== baseDirectory) throw new Error('Gate directory must be project-local');
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (realpathSync(directory) !== directory) throw new Error('Gate directory must be project-local');
  const path = join(directory, `${gate}.r${round}.${id}.md`);
  const fullPath = join(directory, `${id}.full.md`);
  const full = [];
  function preview(title, text, limit, summary = text) {
    if (text === summary && Buffer.byteLength(text) <= limit) return `## ${title}\n${text}`;
    const anchor = title.toLowerCase().replace(/[^a-z0-9 -]/g, '').replaceAll(' ', '-');
    full.push(`## ${title}\n${text}`);
    return `## ${title}\n${clip(summary, limit)}\nFull: ${relative(project, fullPath)}#${anchor}`;
  }

  const candidate = commit(project, candidateRef);
  const base = candidate && commit(project, baseRef ?? `${candidate}^`);
  if (!candidate || baseRef !== undefined && !base) {
    throw new CommandError('invalid-arguments', 'Gate requires a valid candidate commit and, if supplied, a valid base commit');
  }
  const statCommand = base ? `git diff --stat ${base} ${candidate}` :
    `git diff-tree --root --no-commit-id -r --stat ${candidate}`;
  const stat = base ? git(project, 'diff', '--no-ext-diff', '--stat=64,40,5', base, candidate, '--') :
    git(project, 'diff-tree', '--root', '--no-commit-id', '-r', '--stat=64,40,5', candidate, '--');
  if (stat === null) throw new CommandError('unavailable', 'Could not calculate the gate diff stat');
  const statLines = stat.split('\n');
  const totals = clip(statLines.pop() || 'No changes.', 100);
  const diff = [clip(statLines.join('\n'), 239 - Buffer.byteLength(totals)), totals].filter(Boolean).join('\n');
  const artifacts = readArtifacts(project);
  const cards = members.flatMap(row => artifacts.cards(row.addr))
    .sort((a, b) => (b.data.endedAt ?? 0) - (a.data.endedAt ?? 0));
  const evidence = cards.map(card => `- ${relative(project, card.path)} · ${oneLine(card.summary)}`);
  const redFacts = cards.flatMap(card => workerRedFacts(card.data.git));
  const redLines = [...new Set(redFacts.map(fact => `- ${fact.reason} · ${oneLine(fact.file)}`))];
  if (red) redLines.unshift(`- Leader confirmed ${red.reason} · ${oneLine(red.text)}`);
  const checks = cards.flatMap(({ data }) => data.verification?.commands ?? []);
  const passed = checks.filter(check => check.result === 'passed').length;
  const failed = checks.filter(check => check.result === 'failed').length;
  const sandboxed = checks.filter(check => check.sandboxed === true).length;
  const reviews = members.filter(row => row.role === 'reviewer').flatMap(row => {
    const job = jobs.get(row.addr);
    const result = messages.find(message => message.id === job?.firstId)?.completion;
    const verdict = result && result.at <= (job?.reviewDeadline ?? Infinity) && (result.body ?? result.unconfirmedBody);
    const conclusion = Boolean(verdict && conclusoryReply(verdict));
    const detail = conclusion && `${result.body ? '' : 'UNCONFIRMED '}${verdict.trimStart().split('\n', 1)[0]}`;
    return detail ? [{ summary: `- ${row.addr} · ${oneLine(detail)}`, text: `### ${row.addr}\n${verdict}` }] : [];
  });
  const questions = [question, ...decisions.map(event => event.text)]
    .filter(Boolean).map(value => '- ' + value);
  const redEvidence = red ? [
    ...redLines.slice(1), `- Leader confirmed ${red.reason}\n\n${red.text}`,
  ] : redLines;
  const sections = [
    `# Gate ${gate} · Round ${round}\n\nBase: ${base ?? '(root)'}\nCandidate: ${candidate}`,
    preview('Evidence cards', `${cards.length} cards · .project/evidence/\n${bullet(evidence, 'No recorded cards.')}`, 250),
    preview('Diff --stat', stat || 'No changes.', 240, diff),
    `## Test summary\n${checks.length ? `${passed} passed, ${failed} failed, ${checks.length - passed - failed} inconclusive commands; ${sandboxed} ran in a sandbox.` : 'No verified test commands.'}`,
    ...(reviews.length ? [preview('Reviewer verdicts', reviews.map(item => item.text).join('\n\n'), 175,
      reviews.map(item => item.summary).join('\n'))] : []),
    preview('Open questions', bullet(questions, 'None recorded.'), 110),
    preview('Red facts', bullet(redEvidence, 'None recorded.'), 170, bullet(redLines, 'None recorded.')),
    preview('Drift and fact checks', `${signalCount} signals\n${signalSummary || 'None recorded.'}`, 165),
    ...(memoryProposals ? [preview('Memory proposals for Auditor review', memoryProposals, 8192)] : []),
    `## Pointers\n- \`${statCommand}\`\n- Pending decisions: \`loom notifications\``,
  ];
  if (full.length) writeState(fullPath, `# Gate ${gate} · Round ${round}\n\n${full.join('\n\n')}\n`);
  writeState(path, sections.join('\n\n') + '\n');
  return { path, ...(full.length && { fullPath }) };
}
