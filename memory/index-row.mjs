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
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const sentence = /[。！？]|[.!?](?=\s|$)/gu;
const clause = /[。！？；，;]|[.!?](?=\s|$)|—{2,}/gu;
const placeholder = /^see the entry for details[.!。]?$/iu;
const bareId = /^(?:memory-event-)?[a-f\d]{64}$|^[a-f\d]{8}$/iu;
const openingSeparators = /^[\s,，、。！？；;：:—–…!?]+/u;

function textPrefix(value, limit, preferClause = false) {
  const chars = Array.from(value);
  if (chars.length <= limit) return value;
  const max = chars.slice(0, limit - 1).join('').length;
  if (preferClause) {
    const boundary = [...value.matchAll(clause)].findLast(match => match.index + match[0].length <= max);
    if (boundary && length(value.slice(0, boundary.index)) >= limit / 2) {
      return value.slice(0, boundary.index + boundary[0].length);
    }
  }
  // Treat paths, line references and hyphenated identifiers as single words.
  const tokens = /[./\\~#@-]*[\p{Script=Latin}\d_]+(?:[./:\\@+%#?=&~-]+[\p{Script=Latin}\d_]+)*|[^\p{Script=Latin}\d_\s]+/gu;
  let end = 0;
  for (const { 0: token, index } of value.matchAll(tokens)) {
    if (index >= max) break;
    if (/\p{Script=Latin}|\d|_/u.test(token)) {
      if (index + token.length <= max) end = index + token.length;
    } else {
      for (const part of segmenter.segment(token)) {
        const boundary = index + part.index + part.segment.length;
        if (boundary > max) break;
        end = boundary;
      }
    }
  }
  return value.slice(0, end).trimEnd();
}

function clip(value, limit, prefix = textPrefix(value, limit)) {
  return prefix === value || !prefix ? prefix : prefix.replace(/[\s,，、；;：:—]+$/u, '') + '…';
}

function rowText(entry) {
  const original = singleLine(entry.title);
  const title = placeholder.test(original) || bareId.test(original) ? '' : original;
  const prefix = textPrefix(title, 60, true);
  const body = typeof entry.body === 'string' ? entry.body : '';
  const guidance = /^\s*How to apply\s*[:：]\s*(.+)$/imu.exec(body)?.[1];
  const withoutRulingNumber = value => entry.kind === 'ruling' ? value.replace(/^R\d+\s+/iu, '') : value;
  const opening = withoutRulingNumber(prefix).trimEnd();
  for (const text of [guidance, body]) {
    let remaining = withoutRulingNumber(singleLine(text));
    const following = remaining.slice(opening.length);
    const joinedWord = /[\p{Script=Latin}\d_]$/u.test(opening) &&
      /^(?:[./:\\@+%#?=&~-]+)?[\p{Script=Latin}\d_]/u.test(following);
    if (opening && !joinedWord && remaining.toLowerCase().startsWith(opening.toLowerCase())) {
      remaining = following.replace(openingSeparators, '').replace(/^\.(?=\s|$)\s*/u, '');
    }
    const stop = remaining.matchAll(sentence).next().value;
    const first = stop ? remaining.slice(0, stop.index + stop[0].length) : remaining;
    if (first && !placeholder.test(first) && !/^R\d+[。.!?]?$/iu.test(first)) {
      return { title: clip(title, 60, prefix), summary: first };
    }
  }
  return { title: clip(title, 60, prefix), summary: '' };
}

export function substantiveIndexRow(entry) {
  const original = singleLine(entry.title);
  if (!shortMemoryId(entry.id) || !original || placeholder.test(original) || bareId.test(original)) return false;
  const { title, summary } = rowText(entry);
  return Boolean(title && (summary || !placeholder.test(singleLine(entry.body))));
}

export function formatIndexRow(entry, legacyLine, limit = 150) {
  const id = shortMemoryId(entry.id);
  if (!id) return clip(legacyLine, limit);
  const { title, summary } = rowText(entry);
  const label = (title || 'Untitled memory').replace(/[\[\]]/gu, char => char === '[' ? '［' : '］');
  const prefix = `- [${label}](${id})`;
  const excerpt = clip(summary, limit - length(prefix) - 3);
  return excerpt ? prefix + ' — ' + excerpt : prefix;
}
