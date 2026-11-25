// Orca b7fd7caa3, src/main/runtime/terminal/output/startup-dialog-screen.ts:
// trustChoiceKeys, with an explicit cursor count and named hc keys.
const TRUST_DIALOG_CURSOR_RE = /^[\u276f\u203a]/;
const TRUST_DIALOG_CHOICE_RE =
  /^(?:[\u276f\u203a]\s*)?(?:\d+\.\s*)?(?:yes, i trust this folder|trust and continue)$/;
const TRUST_DIALOG_CHOICE_ROWS = 6;

export function trustKeys(rows) {
  const choices = rows.slice(-TRUST_DIALOG_CHOICE_ROWS, -1).map(line => line.toLowerCase());
  const cursor = choices.findIndex(line => TRUST_DIALOG_CURSOR_RE.test(line));
  const trust = choices.findIndex(line => TRUST_DIALOG_CHOICE_RE.test(line));
  if (cursor === -1 || trust === -1 || Math.abs(trust - cursor) > 1 ||
      choices.slice(cursor + 1).some(line => TRUST_DIALOG_CURSOR_RE.test(line)) ||
      choices.slice(trust + 1).some(line => TRUST_DIALOG_CHOICE_RE.test(line))) return [];
  return trust === cursor ? ['enter'] : [trust > cursor ? 'down' : 'up', 'enter'];
}

export function inspectScreen(classify, text) {
  const kind = classify(text);
  return { kind, ...(kind === 'unknown' && {
    code: 'UNKNOWN',
    evidence: { screen: (typeof text === 'string' ? text : '').split('\n').slice(-32).join('\n').slice(-8_192) },
  }) };
}
