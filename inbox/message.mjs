import { createHash } from 'node:crypto';

const marker = /^\[loom:([0-9a-f-]{36})\](?:\r?\n|$)/;
export const messageIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const isBlockedReply = body => replyConclusion(body).tag === 'BLOCKED';
export const deliveryFailed = message => ['refused', 'corrupted', 'target-ended'].includes(message?.phase);

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
const decision = /^(DONE|BLOCKED|FAILED|PASS(?:ED)?|FAIL|REJECT(?:ED)?|APPROVE(?:D)?|VERIFIED|LGTM|VERDICT|结论|裁决)(?=$|[\s*_:：.!！。])/i;
const acknowledgement = /^(?:(?:已?收到|确认收到|已阅)(?:本条|门禁包|(?:门禁|审查|测试)?(?:材料|消息|回执))?|收到确认|继续等待|在等|ACK|acknowledged|received(?: (?:the )?(?:gate packet|message))?|noted|waiting)(?:[\s,，。.!！:：]+(?:received|继续等待|继续等候|等待裁决|谢谢|thanks|thank you))*[\s,，。.!！]*$/i;

export function replyConclusion(text) {
  if (typeof text !== 'string' || !text.trim()) return { reason: 'no-final-reply' };
  const lines = text.split(/\r?\n/);
  let found;
  let fence;
  const content = [];
  for (const [index, raw] of lines.entries()) {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(raw)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence || /^\s*>/.test(raw)) continue;
    const line = raw.replace(/^[#*_\s+-]+/, '').trimEnd();
    if (!line) continue;
    if (/^NOREPLY(?=$|[\s*_:：.!])/i.test(line)) return { reason: 'noreply' };
    content.push(line);
    const tag = decision.exec(line)?.[1];
    if (tag && !found) found = { tag: tag.toUpperCase(), index };
  }
  if (found) {
    if (found.index === 0) return { tag: found.tag, body: text };
    const [line] = lines.splice(found.index, 1);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    while (lines.at(-1) === '' && found.index >= lines.length) lines.pop();
    return { tag: found.tag, body: [line, '', ...lines].join(eol) };
  }
  if (content.length && content.every(line => acknowledgement.test(line) ||
      /(?:无需回复(?:本条)?|不必回复|不(?:再|另)(?:回复|发消息)|no reply)(?:[。.!！])?$/i.test(line))) {
    return { reason: 'acknowledgement' };
  }
  return { reason: 'missing-tag' };
}

export function conclusoryReply(text, gate = false) {
  const { tag, reason } = replyConclusion(text);
  if (tag) return true;
  if (!gate || reason !== 'missing-tag') return false;
  const first = text.trimStart().split(/\r?\n/, 1)[0];
  return /批准|退回|拒绝|复核通过|审核通过|可合入|暂缓合入|禁止合入|阻断|^(?:accepted|changes requested|looks good|no blockers)\b/i.test(first);
}
export const checksDeliveryIntegrity = target => ['claude', 'agy'].includes(target.provider) && target.tui?.transport === 'holder-v3';

export function combinedDeliveryText(message, waves, separator = message.waveSeparator ?? '\n\n') {
  if (message.wireBody !== undefined) return message.wireBody;
  const body = waves.length ? [...(message.superPriority ? ['Loom Super message', message.text, '--- Loom wave results ---'] :
    ['Loom worker results', message.text]), ...waves.map(wave => wave.text)].join(separator) : message.text;
  return message.orgAppendix ? body + '\n\n' + message.orgAppendix : body;
}

export const claudeDigestVersion = 2;

export function claudeNativeDigest(prompt, id, expected) {
  if (typeof prompt !== 'string' || deliveryId(prompt) !== id) return;
  let input = prompt.trimStart();
  let terminalNewline;
  const pasted = /^<pasted_content(?: id="([a-zA-Z0-9_-]+)")?>\r?\n/.exec(input);
  if (pasted) {
    const closing = `</pasted_content${pasted[1] ? ` id="${pasted[1]}"` : ''}>`;
    input = input.slice(pasted[0].length);
    const end = input.lastIndexOf(`\n${closing}`);
    // Keep stray bytes after the close tag, including a replacement
    // character produced by a short write. They are part of the input.
    if (end >= 0) {
      const after = input.slice(end + 1 + closing.length).replace(/^\r?\n/, '');
      const start = input[end - 1] === '\r' ? end - 1 : end;
      if (!after) terminalNewline = input.slice(start, end + 1);
      input = input.slice(0, start) + after;
    }
  }
  const prefix = `[loom:${id}]`;
  if (!input.startsWith(prefix)) return;
  const body = input.slice(prefix.length).replace(/^\r?\n/, '');
  // Claude can reuse the payload's own newline as the wrapper separator.
  // Accept it only if that exact variant matches the reserved body.
  if (terminalNewline && expected && payloadDigest(body + terminalNewline) === expected) return expected;
  return payloadDigest(body);
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
