import { matchesGlob, relative } from 'node:path';
import { readArtifacts } from '../cli/artifacts.mjs';

const domains = {
  persistence: ['{index,memory,inbox,relay}/**', 'daemon/{io,org,audit-findings,turn-heads}.mjs', '**/*{persist,store,journal}*'],
  retry: ['{inbox,relay}/**', 'daemon/{codex-pipe-session,sessions,session-host}.mjs', '**/*{retry,reconnect}*'],
  idempotency: ['{inbox,relay}/**', 'daemon/{codex-pipe-session,audit-findings}.mjs', '**/*{idemp,dedup,receipt}*'],
  egress: ['lint/**', 'loom.lint.json', 'lib/unix-socket.mjs', '**/*{egress,network,destination,fetch,http}*'],
};

function redProof(project, path, verification, related) {
  if (!verification.expectRed) return;
  const commands = [...related.map(item => [item.path, item.data.verification?.commands ?? []]), [path, verification.commands]]
    .flatMap(([file, checks]) => checks.map((check, i) => ({
      check, ref: relative(project, file) + '#/verification/commands/' + i,
    })));
  const red = commands.findIndex(({ check }) => check.runner !== 'loom-lint' && check.result === 'failed' &&
    (check.counts?.failed > 0 || check.invariants?.some(item => item.result === 'failed')));
  if (red === -1) return { status: 'missing' };
  const { check, ref } = commands[red];
  const green = commands.slice(red + 1).find(entry =>
    entry.check.command === check.command && entry.check.cwd === check.cwd && entry.check.result === 'passed' && entry.check.counts?.passed > 0);
  return { status: green ? 'red-green' : 'red-observed', red: ref, ...(green && { green: green.ref }) };
}

export function verificationDetails(project, path, data, settings) {
  const { git, verification, addr, task, endedAt } = data;
  const related = addr && endedAt != null ? readArtifacts(project).cards(addr)
    .filter(item => item.data.task === task && item.data.endedAt != null && item.data.endedAt < endedAt)
    .sort((a, b) => a.data.endedAt - b.data.endedAt) : [];
  const proof = redProof(project, path, verification, related);
  const files = (git.files ?? []).flatMap(file => [file.path, file.previousPath].filter(Boolean));
  const touched = Object.entries(domains).filter(([name, globs]) =>
    files.some(file => [...globs, ...(settings.invariantPaths?.[name] ?? [])].some(glob => matchesGlob(file, glob)))).map(([name]) => name);
  const required = [...new Set([...related.flatMap(item => item.data.checks?.invariants?.required ?? []), ...touched])];
  // Reuse command proof across turns only when both recorded worktree trees match.
  const sameWorktree = related.filter(item => git.tree && item.data.git?.tree === git.tree);
  const tested = [...sameWorktree.map(item => [relative(project, item.path), item.data.verification?.commands ?? []]),
    ['', verification.commands]].flatMap(([file, commands]) => commands.flatMap((check, i) => (check.invariants ?? []).map(item => ({
    ...item, evidence: file + '#/verification/commands/' + i,
  }))));
  const latest = new Map(tested.map(item => [JSON.stringify([item.category, item.name]), item]));
  const checks = [...latest.values()];
  const gaps = required.filter(category => !checks.some(check => check.category === category && check.result === 'passed') ||
    checks.some(check => check.category === category && check.result === 'failed'));
  const lint = verification.commands.flatMap((check, i) => check.lint ||
    check.runner === 'loom-lint' && check.result !== 'unknown' ?
    [{ result: check.lint ?? check.result, evidence: '#/verification/commands/' + i }] : []).at(-1) ??
    { result: 'unobserved' };
  const testDiff = (git.tests ?? []).filter(test => test.status === 'D' || test.assertions?.length ||
    test.directives?.length || test.deletedTests?.length).map(test => ({
    path: test.path, ...(test.previousPath && { previousPath: test.previousPath }), deletedFile: test.status === 'D',
    assertions: test.assertions ?? [], addedDirectives: test.directives ?? [], deletedTests: test.deletedTests ?? [],
  }));
  return { lint, testDiff, ...(proof && { redProof: proof }), ...(required.length || checks.length ? {
    invariants: { required, checks, gaps },
  } : {}) };
}

export function verificationSummary({ lint, testDiff, redProof, invariants } = {}) {
  const missing = invariants?.gaps.length ? ' · 未证 ' + invariants.gaps.join('/') : '';
  const labels = [lint && 'lint ' + lint.result,
    testDiff?.length && '测试 diff ↗ testDiff',
    invariants && '不变量 ' + invariants.checks.length + missing,
    redProof && (redProof.red ? 'RED ↗ ' + redProof.red : 'RED 待证')];
  return labels.filter(Boolean).join(' · ');
}
