export const approval = 'awaiting-approval';
export const choice = 'awaiting-choice';
const kinds = new Map([['permission', approval], ['choice', choice], ['picker', 'picker'], ['overlay', 'overlay'],
  [approval, approval], [choice, choice]]);

export const promptKind = kind => kinds.get(kind);

const defaults = {
  [approval]: 'Tool approval', [choice]: 'Question for the user', picker: 'Selection menu', overlay: 'Interactive overlay',
};

export function promptDetails(kind, summary, options) {
  kind = promptKind(kind);
  if (!kind) return;
  const clean = typeof summary === 'string' && summary.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').trim();
  return { kind, summary: clean ? Array.from(clean).slice(0, 120).join('') : defaults[kind],
    options: Number.isSafeInteger(options) && options >= 0 ? options : null };
}

export function questionDetails(questions, fallback) {
  const question = Array.isArray(questions) ? questions[0] : undefined;
  return promptDetails(choice, question?.question ?? fallback, Array.isArray(question?.options) ? question.options.length : null);
}

export function screenPrompt(kind, text) {
  kind = promptKind(kind);
  if (!kind) return;
  const rows = text.trim().split('\n').map(line => line.trim().replace(/^[│┃]\s+|\s+[│┃]$/g, '')).filter(Boolean).slice(-38);
  const option = /^(?:[❯›>◯◉○●]\s*)?(?:\d+[.)]|\[[ x✓]\])\s+(.+)$/i;
  const heading = {
    [approval]: /^(?:[△◆]\s*)?(?:permission required|run this command\?|would you like to run\b|do you want to (?:allow|make|run|proceed)|select approval mode|update model permissions)/i,
    [choice]: /^(?:question \d+\/\d+:\s*|[?]\s+)?[^›❯>].*\?$/i,
    picker: /^(?:select (?:a )?(?:model|effort|reasoning level|conversation)|switch model|commands\b|resume (?:a )?(?:session|conversation)|choose a theme)/i,
    overlay: /^(?:how['’]s the cli experience|introducing gemini)/i,
  };
  const firstOption = rows.findLastIndex(line => /^(?:[❯›>◯◉○●]\s*)?1[.)]\s+/.test(line));
  const scope = kind === choice && firstOption > 0 ? rows.slice(0, firstOption) : rows;
  const index = scope.findLastIndex(line => heading[kind].test(line));
  const summary = index < 0 ? undefined : scope[index].replace(/^(?:[△◆?]\s+|Question \d+\/\d+:\s*)/i, '')
    .replace(/\s+esc$/i, '');
  const count = rows.slice(kind === choice && firstOption >= 0 ? firstOption : index + 1)
    .map(line => option.exec(line)?.[1]).filter(label =>
    label && !/^(?:type something|write-in|type your own answer|chat about this|none of the above|submit answers?)\b/i.test(label)).length;
  const total = kind === 'picker' && Number(/^(?:Select model|Select agent) (?:\d+\/)?(\d+)\s+esc$/i.exec(rows[index] ?? '')?.[1]);
  return promptDetails(kind, summary, total || count || (kind === approval && rows.some(line =>
    /^Allow once\s+Always allow\s+Reject/i.test(line)) ? 3 : null));
}

export function codexPrompt(method, params) {
  if (/^(?:item\/(?:commandExecution|fileChange|permissions)\/requestApproval|applyPatchApproval|execCommandApproval)$/.test(method)) {
    return promptDetails(approval, params?.reason, params?.availableDecisions?.length);
  }
  if (method === 'item/tool/requestUserInput') return questionDetails(params?.questions);
  if (method === 'mcpServer/elicitation/request') return promptDetails(choice, params?.message);
}
