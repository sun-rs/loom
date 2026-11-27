import { checkFacts, plannedCardPaths } from '../evidence/facts.mjs';
import { inDirectory } from '../cli/project.mjs';

const current = /(?:^|\b)(?:current\s+(?:head|sha|commit)|(?:current\s+)?HEAD|当前\s*(?:HEAD|SHA|提交))\s*(?::|：|=|\bis\b|\bat\b|为)\s*`?([a-f0-9]{7,64})(?![\w-])/gi;
const branch = /(?:^|\s)(refs\/heads\/[\w./-]+)\s*(?::|=|\bis at\b|\bat\b)\s*`?([a-f0-9]{7,64})(?![\w-])/gi;

export function referencedAnomalies(project, cwd, body, git, { dispatch = false } = {}) {
  if (!cwd || !inDirectory(project, cwd)) return [];
  const findings = checkFacts(body, cwd, project, undefined, { pathBoundary: project, locationsOnly: true,
    ...(dispatch && { plannedPaths: plannedCardPaths(body) }) }).misses;
  const missing = new Set(findings.filter(item => item.kind === 'sha').map(item => item.value));
  const refs = new Map();
  for (const line of body.split(/\r?\n/).filter(line => !/^\s*>/.test(line))) {
    for (const [ref, matches] of [['HEAD', [...line.matchAll(current)]], [null, [...line.matchAll(branch)]]]) {
      for (const match of matches) {
        const { label, value } = ref ? { label: ref, value: match[1] } : { label: match[1], value: match[2] };
        const claimed = value.toLowerCase();
        if (missing.has(claimed)) continue;
        if (!refs.has(label)) refs.set(label, git(cwd, ['rev-parse', '--verify', '--end-of-options', `${label}^{commit}`]));
        const expected = refs.get(label);
        if (expected && !expected.startsWith(claimed)) findings.push({ kind: 'stale-sha', value: label + ' ' + claimed, expected });
      }
    }
  }
  return [...new Map(findings.map(item => [JSON.stringify(item), item])).values()].slice(0, 20);
}

// The ledger contains successful as well as flagged dispatches. A missing flag
// on an intervening actual dispatch cannot join two unrelated omissions.
export function consecutiveOmissions(dispatches) {
  const records = Object.values(dispatches ?? {});
  return records.find((item, index) => item.constraint?.verdict === 'omitted' && records[index - 1]?.constraint?.verdict === 'omitted');
}
