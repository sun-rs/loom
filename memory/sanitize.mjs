function redact(text, classifySensitive, replacement) {
  if (!classifySensitive || text === '') return text;
  const classification = classifySensitive(text);
  if (classification?.reliable !== true || !Array.isArray(classification.spans)) {
    throw new Error('Unreliable classification');
  }
  const spans = classification.spans.toSorted((a, b) => a.start - b.start);
  let end = 0;
  let safe = '';
  for (const span of spans) {
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end)
      || span.start < 0 || span.end > text.length || span.end <= span.start) {
      throw new Error('Invalid redaction range');
    }
    if (span.start >= end) safe += text.slice(end, span.start) + replacement;
    end = Math.max(end, span.end);
  }
  return safe + text.slice(end);
}

export function sanitizeEntry(entry, { classifySensitive, replacement = '[REDACTED]' } = {}) {
  function visit(value) {
    if (typeof value === 'string') return redact(value, classifySensitive, replacement);
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, visit(field)]));
    }
    return value;
  }

  try {
    return { ok: true, entry: visit(entry) };
  } catch {
    return { ok: false, code: 'invalid', error: 'Memory content could not be reliably redacted' };
  }
}
