import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readArtifacts } from '../cli/artifacts.mjs';
import { CommandError } from '../cli/sessions.mjs';
import { clip } from '../evidence/checks.mjs';
import { readText, writeState } from './io.mjs';
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

export function saveGatePacket(project, { id, gate, base: baseRef, candidate: candidateRef = 'HEAD', question },
  { members, jobs, messages, decisions, signalSummary, signalCount, red }) {
  const baseDirectory = join(project, '.project');
  const directory = join(baseDirectory, 'gates');
  if (realpathSync(baseDirectory) !== baseDirectory) throw new Error('Gate directory must be project-local');
  try { mkdirSync(directory, { mode: 0o700 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (realpathSync(directory) !== directory) throw new Error('Gate directory must be project-local');
  const path = join(directory, `${gate}.${id}.md`);
  if (readText(path, null) !== null) return path;

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
  const reviews = members.filter(row => row.role === 'reviewer').map(row => {
    const returned = messages.find(message => message.reviewerResult === row.addr)?.text;
    const first = messages.find(message => message.id === jobs.get(row.addr)?.firstId);
    const verdict = first?.completion?.body ?? first?.completion?.unconfirmedBody;
    const detail = returned?.split('\n\n', 2)[1] ?? (verdict && conclusoryReply(verdict) ?
      first.completion.body ?? 'UNCONFIRMED ' + verdict : undefined);
    return `- ${row.addr} · ${clip(oneLine(detail?.split('\n', 1)[0] || 'verdict unavailable'), 140)}`;
  });
  const questions = [question, ...decisions.map(event => event.text)]
    .map(oneLine).filter(Boolean).map(value => '- ' + value);
  const sections = [
    `# Gate ${gate}\n\nBase: ${base ?? '(root)'}\nCandidate: ${candidate}`,
    `## Evidence cards\n${cards.length} cards · .project/evidence/\n` + clip(bullet(evidence, 'No recorded cards.'), 250),
    '## Diff --stat\n' + diff,
    `## Test summary\n${checks.length ? `${passed} passed, ${failed} failed, ${checks.length - passed - failed} inconclusive commands; ${sandboxed} ran in a sandbox.` : 'No verified test commands.'}`,
    `## Reviewer verdicts\n${reviews.length} reviewers\n` + clip(bullet(reviews, 'No recorded reviewer.'), 175),
    '## Open questions\n' + clip(bullet(questions, 'None recorded.'), 110),
    '## Red facts\n' + clip(bullet(redLines, 'None recorded.'), 170),
    `## Drift and fact checks\n${signalCount} signals · \`loom status --json\`\n` + clip(signalSummary || 'None recorded.', 165),
    `## Pointers\n- \`${statCommand}\`\n- Reviewer transcripts: \`loom hist <reviewer-addr> --turns 1\`\n- Pending decisions: \`loom notifications\``,
  ];
  writeState(path, sections.join('\n\n') + '\n');
  return path;
}
