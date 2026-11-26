const shortPattern = /^[a-f\d]{8}$/iu;
const generatedPattern = /^memory-(?:([a-f\d]{8})(?:-[a-f\d]{4}){3}-[a-f\d]{12}|event-([a-f\d]{8})[a-f\d]{56})$/iu;

export const isShortMemoryId = id => typeof id === 'string' && shortPattern.test(id);
export function shortMemoryId(id) {
  const match = generatedPattern.exec(id);
  return (match?.[1] ?? match?.[2])?.toLowerCase();
}

export function resolveShortMemoryId(rows, id, visible) {
  const matches = rows.filter(row => shortMemoryId(row.id) === id.toLowerCase() && visible(row));
  if (matches.length === 1) return { item: matches[0] };
  return matches.length ? { code: 'ambiguous', error: 'Ambiguous memory ID. Use the full ID.' } :
    { code: 'not-found', error: 'Memory entry not found' };
}

const singleLine = value => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
const length = value => Array.from(value).length;
function clip(value, limit) {
  const chars = Array.from(value);
  return chars.length <= limit ? value : chars.slice(0, limit - 1).join('').trimEnd() + '…';
}

function hook(body) {
  if (typeof body !== 'string') return '';
  const sentence = body.split(/\r?\n/u).find(line => /^\s*How to apply\s*[:：]/iu.test(line))
    ?.replace(/^\s*How to apply\s*[:：]\s*/iu, '') || body;
  return singleLine(sentence).match(/^.*?(?:[。！？]|[.!?](?=\s|$)|$)/u)?.[0];
}

export function substantiveIndexRow(entry) {
  return Boolean(shortMemoryId(entry.id) && singleLine(entry.title) && hook(entry.body));
}

export function formatIndexRow(entry, legacyLine) {
  const id = shortMemoryId(entry.id);
  if (!id) return clip(legacyLine, 150);
  const summary = hook(entry.body) || 'See the entry for details.';
  const title = (singleLine(entry.title) || 'Untitled memory').replace(/[\[\]]/gu, char => char === '[' ? '［' : '］');
  const label = clip(title, 150 - length(`- [](${id}) — `) - Math.min(length(summary), 40));
  const prefix = `- [${label}](${id}) — `;
  return prefix + clip(summary, 150 - length(prefix));
}
