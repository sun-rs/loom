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

function hook(entry, title) {
  if (typeof entry.body !== 'string') return '';
  const guidance = entry.body.split(/\r?\n/u).find(line => /^\s*How to apply\s*[:：]/iu.test(line))
    ?.replace(/^\s*How to apply\s*[:：]\s*/iu, '');
  const withoutRulingNumber = value => entry.kind === 'ruling' ? value.replace(/^R\d+\s+/iu, '') : value;
  const opening = withoutRulingNumber(title.replace(/…$/u, '')).trimEnd();
  for (const text of [guidance, entry.body]) {
    let remaining = withoutRulingNumber(singleLine(text));
    if (opening && remaining.toLowerCase().startsWith(opening.toLowerCase())) {
      remaining = remaining.slice(opening.length).replace(/^[\s\p{P}]+/u, '');
    }
    if (remaining) return remaining.match(/^.*?(?:[。！？]|[.!?](?=\s|$)|$)/u)?.[0];
  }
  return '';
}

export function substantiveIndexRow(entry) {
  return Boolean(shortMemoryId(entry.id) && singleLine(entry.title) && hook(entry, clip(singleLine(entry.title), 60)));
}

export function formatIndexRow(entry, legacyLine) {
  const id = shortMemoryId(entry.id);
  if (!id) return clip(legacyLine, 150);
  const title = clip(singleLine(entry.title) || 'Untitled memory', 60);
  const summary = hook(entry, title) || 'See the entry for details.';
  const label = title.replace(/[\[\]]/gu, char => char === '[' ? '［' : '］');
  const prefix = `- [${label}](${id}) — `;
  return prefix + clip(summary, 150 - length(prefix));
}
