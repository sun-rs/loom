const marker = /^\[loom:([0-9a-f-]{36})\](?:\r?\n|$)/;
export const messageIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const isBlockedReply = body => typeof body === 'string' && /^\**BLOCKED(?:\s|$)/i.test(body.trimStart().split(/\r?\n/, 1)[0]);

export function deliveryId(text) {
  if (typeof text !== 'string') return;
  // hc attributes messages to its caller. agy may also wrap native user input.
  const input = text.replace(/^\s*(?:(?:<USER_REQUEST>|<(?:hc|pasted_content)(?:\s+[^>\r\n]*)?>)\s*)*/, '');
  return marker.exec(input)?.[1];
}

export function wireText(id, message) {
  return `[loom:${id}]\n${message}`;
}
