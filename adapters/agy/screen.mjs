import { classifyScreen, stripAnsiAndControl } from './lib/classify-screen.mjs';

// Orca b7fd7caa3: src/main/runtime/agent-state-rules/antigravity.json,
// composer_ready and composer_ready_background_tasks. A draft removes the hint.
const RULE = '─{8,}';
const COMPOSER = '>[ \\t]*(?:[a-z][a-z-]* mode:[ \\t][^\\n]+)?';
const TASKS = '(?:●\\s+\\[\\d{1,2}:\\d{2}:\\d{2}\\]\\s+\\S[^\\n]*\\n){1,6}';
const idleComposer = new RegExp(
  `^${RULE}\\n${COMPOSER}\\n${RULE}\\n(?:${TASKS}${RULE}\\n)?\\? for shortcuts[^\\n]*$`, 'im',
);
const busyComposer = new RegExp(`^${RULE}\\n${COMPOSER}\\n${RULE}\\nesc to cancel[^\\n]*$`, 'im');
const heldComposer = new RegExp(`(?:^|\\n)${RULE}\\n>\\n${RULE}(?:\\n${TASKS}${RULE})?$`);
const modelFooter = /^(?:accept-edits|auto|plan|yolo)\s+·\s+[^·]+\s+·\s+(?:low|medium|high|xhigh|max)$/i;
const trustFooter = /^↑\/↓\s+Navigate\s+·\s+enter Confirm$/i;
const pickerFooter = /^Keyboard:.*\besc Go Back$/i;
const announcementTitle = /^Introducing Gemini \d+(?:\.\d+)? (?:Neon|Carbon|Argon|Hydrogen)[!.]?(?:\s+[·•]\s+|\s{2,}|$)/i;
const announcementDismiss = /^(?:\(\s*)?(?:press )?esc to dismiss\s*[.)]?$/i;
const ruleRow = new RegExp(`^${RULE}$`);
const settingsError = /^failed to (?:load|read|save|write) settings\b/i;
const interactiveStatus = /[─↑↓⏎]|\b(?:esc|enter|select|cancel|confirm|navigate|for shortcuts)\b|^(?:error|warning|failed|unable)\b/i;

function rowsOf(text, keepBlanks = false) {
  const rows = stripAnsiAndControl(text).trimEnd().split('\n').map(line => line.trim())
    .filter(line => keepBlanks || line).slice(-32);
  if (modelFooter.test(rows.at(-1) ?? '')) rows.pop();
  return rows;
}

export function hasEmptyComposer(text) {
  const rows = rowsOf(text, true);
  while (rows.at(-1) === '') rows.pop();
  const body = rows.slice(-10).join('\n');
  if (/^(?:\? for shortcuts|esc to cancel)\b/i.test(rows.at(-1) ?? '')) {
    return idleComposer.test(body) || busyComposer.test(body);
  }
  // Orca antigravity.json's custom status line rule. A bare caret must
  // remain between both rules, with no spinner or interactive keys nearby.
  const bottom = rows.findLastIndex(row => ruleRow.test(row));
  const status = rows.slice(bottom + 1).filter(Boolean);
  return bottom >= 2 && rows[bottom - 1] === '>' && ruleRow.test(rows[bottom - 2]) &&
    !/^[\u2800-\u28ff]/.test(rows[bottom - 3] ?? '') && status.length >= 1 && status.length <= 3 &&
    status.every(row => !modelFooter.test(row) && !interactiveStatus.test(row));
}

export function hasHeldComposer(text) {
  // Agy hides the shortcuts hint while the draft has focus. Its mode/model
  // status is still present directly below the two composer borders.
  const rows = stripAnsiAndControl(text).trimEnd().split('\n').map(line => line.trim());
  return /^(?:accept-edits|auto|plan|yolo) · [^·]+(?: · (?:low|medium|high|xhigh|max))?$/i.test(rows.at(-1) ?? '') &&
    heldComposer.test(rows.slice(-12, -1).join('\n'));
}

export function classify(text) {
  const rows = rowsOf(text);
  const tail = rows.join('\n');
  const footer = rows.at(-1) ?? '';
  const state = classifyScreen('agy', text);
  if (state === 'trust-dialog' || state === 'auth-fail' || state === 'rate-limit') return state;
  if (/^(?:Select login method:|Welcome to the Antigravity CLI\. You are currently not signed in\.)$/im.test(tail)) {
    return 'auth-fail';
  }
  const announcement = rows.slice(-18).map(row => /^[│┃]\s+(.+?)(?:\s*[│┃])?$/.exec(row)?.[1].trim());
  const title = announcement.findLastIndex(row => row && announcementTitle.test(row));
  if (title >= 0) {
    if (announcementDismiss.test(announcement[title].replace(announcementTitle, ''))) return 'overlay';
    for (const row of announcement.slice(title + 1)) {
      if (!row) break;
      if (announcementDismiss.test(row)) return 'overlay';
    }
  }
  if (/^(?:Switch Model|Select a model:?|Choose a theme:?|Select a conversation:?|Resume Conversation)$/im.test(tail) &&
      pickerFooter.test(footer)) return 'picker';
  if (/(?:Allow once|Allow for this session|Do you want to (?:allow|run)|Permission Required)/i.test(tail) &&
      /(?:enter|esc) (?:to )?(?:select|confirm|deny|cancel)\b/i.test(footer)) return 'permission';
  if (/^[\u2800-\u28ff]\s+Compacting\b/imu.test(tail)) return 'compacting';
  if (state === 'busy') return state;
  const emptyAboveSettingsError = rows.at(-3) === '>' && ruleRow.test(rows.at(-2)) && ruleRow.test(rows.at(-4));
  if (emptyAboveSettingsError && settingsError.test(footer) ||
      /^(?:⎿\s*)?(?:Error: (?:failed to|request failed)|Request failed with status [45]\d\d)\b/im.test(tail)) return 'error';
  if (!/^esc to cancel\b/i.test(footer) && hasEmptyComposer(text)) return 'idle';
  return 'unknown';
}

export function dialogKeys(kind, text) {
  const rows = rowsOf(text);
  if (kind === 'trust-dialog' && trustFooter.test(rows.at(-1) ?? '') &&
      rows.at(-2) === 'No, exit' && rows.at(-3) === '> Yes, I trust this folder' &&
      rows.some(line => line === 'Do you trust the contents of this project?')) return ['enter'];
  if (kind === 'picker' && classify(text) === 'picker') return ['esc'];
  return [];
}
