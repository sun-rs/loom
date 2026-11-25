import { createHash } from 'node:crypto';

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
export const payloadDigest = text => createHash('sha256').update(text).digest('hex');
export const checksDeliveryIntegrity = target => ['claude', 'agy'].includes(target.provider) && target.tui?.transport === 'holder-v3';

export function combinedDeliveryText(message, waves) {
  if (!waves.length) return message.text;
  return [...(message.superPriority ? ['Loom Super message', message.text, '--- Loom wave results ---'] :
    ['Loom worker results', message.text]), ...waves.map(wave => wave.text)].join('\n\n');
}

export function claudeNativeDigest(prompt, id) {
  if (typeof prompt !== 'string' || deliveryId(prompt) !== id) return;
  let input = prompt.trimStart();
  const pasted = /^<pasted_content(?: id="([a-zA-Z0-9_-]+)")?>\r?\n/.exec(input);
  if (pasted) {
    const closing = `</pasted_content${pasted[1] ? ` id="${pasted[1]}"` : ''}>`;
    input = input.slice(pasted[0].length);
    const end = input.lastIndexOf(`\n${closing}`);
    // Keep stray bytes after the close tag, including a replacement
    // character produced by a short write. They are part of the input.
    if (end >= 0) input = input.slice(0, end) + input.slice(end + 1 + closing.length).replace(/^\r?\n/, '');
  }
  const prefix = `[loom:${id}]`;
  if (!input.startsWith(prefix)) return;
  return payloadDigest(input.slice(prefix.length).replace(/^\r?\n/, ''));
}

export function agyDeliveryParts(text, expected) {
  const id = deliveryId(text);
  if (!id) return [];
  const prefix = `[loom:${id}]`;
  const body = text.slice(text.indexOf(prefix) + prefix.length).replace(/^\r?\n/, '');
  const whole = payloadDigest(body);
  const first = { id, digest: whole };
  if (!expected(id) || expected(id) === whole) return [first];
  // A nested marker only counts when independently reserved and its entire
  // remaining payload matches. A Loom marker quoted in a valid input is text.
  const suffixes = [...body.matchAll(/\[loom:([0-9a-f-]{36})\]\r?\n/g)].flatMap(match => {
    const next = match[1];
    if (next === id || !expected(next)) return [];
    const digest = payloadDigest(body.slice(match.index + match[0].length));
    return digest === expected(next) ? [{ id: next, digest, index: match.index }] : [];
  });
  if (suffixes.length !== 1) return [first];
  const [next] = suffixes;
  return [{ id, digest: payloadDigest(body.slice(0, next.index)) }, { id: next.id, digest: next.digest }];
}
