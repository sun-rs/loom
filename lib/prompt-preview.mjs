export function promptPreview(value) {
  return String(value ?? '').replace(/<\/?(?:pasted_content|hc)(?:\s[^>]*)?>|\[loom:[^\]\r\n]+\]/gi, ' ')
    .trim().replace(/\s+/g, ' ');
}
