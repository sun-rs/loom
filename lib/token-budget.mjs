// Approximate English at four alphanumeric characters per token. Count each
// Han character, punctuation mark and other non-ASCII code point as one token.
function units(character) {
  return /^[A-Za-z0-9 \t]$/.test(character) ? 1 : 4;
}

export function estimateTokens(text) {
  let total = 0;
  for (const character of text) total += units(character);
  return Math.ceil(total / 4);
}

export function clipTokens(text, limit) {
  if (limit < 1) return '';
  if (estimateTokens(text) <= limit) return text;
  let remaining = (limit - 1) * 4;
  let end = 0;
  for (const character of text) {
    remaining -= units(character);
    if (remaining < 0) break;
    end += character.length;
  }
  return text.slice(0, end).trimEnd() + '…';
}
