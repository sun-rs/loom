import { classifyScreen, stripAnsiAndControl } from './lib/classify-screen.mjs';

// Orca b7fd7caa3: src/main/runtime/agent-state-rules/antigravity.json,
// composer_ready and composer_ready_background_tasks. A draft removes the hint.
const RULE = '─{8,}';
const COMPOSER = '>[ \\t]*(?:[a-z][a-z-]* mode:[ \\t][^\\n]+)?';
const TASKS = '(?:●\\s+\\[\\d{1,2}:\\d{2}:\\d{2}\\]\\s+\\S[^\\n]*\\n){1,6}';
const composerRow = new RegExp(`^${COMPOSER}$`, 'i');
const agyTaskRow = /^●\s+\[\d{1,2}:\d{2}:\d{2}\]\s+\S/;
const backgroundComposer = new RegExp(
  `^${RULE}\\n${COMPOSER}\\n${RULE}\\n${TASKS}${RULE}\\n\\? for shortcuts[^\\n]*$`, 'im',
);
const modelFooter = /^(?:accept-edits|auto|plan|yolo)\s+·\s+[^·\n]+(?:\s+·\s+(?:low|medium|high|xhigh|max))?$/i;
const bareModeFooter = /^(?:accept-edits|auto|plan|yolo)$/i;
const tipFooter = /^(?:[⎿└]\s*)?tip\s*:\s*\S/i;
const trustFooter = /^↑\/↓\s+Navigate\s+·\s+enter Confirm$/i;
const pickerFooter = /^Keyboard:.*\besc Go Back$/i;
const announcementTitle = /^Introducing Gemini \d+(?:\.\d+)? (?:Neon|Carbon|Argon|Hydrogen)[!.]?(?:\s+[·•]\s+|\s{2,}|$)/i;
const announcementDismiss = /^(?:\(\s*)?(?:press )?esc to dismiss\s*[.)]?$/i;
const autoTitle = /^Auto is now the default agent mode[!.]?$/i;
const autoBody = /^Press Shift\+Tab to switch agent modes, or change Agent Mode in \/config\.$/i;
const survey = /^How['’]s the CLI experience so far\? Help us improve: \[1\] Good \[2\] Fine \[3\] Bad \[0\] Skip$/i;
const ruleRow = new RegExp(`^${RULE}$`);
const settingsError = /^failed to (?:load|read|save|write) settings\b/i;
const interactiveStatus = /[─↑↓⏎]|\b(?:esc|enter|select|cancel|confirm|navigate|for shortcuts)\b|^(?:error|warning|failed|unable)\b/i;
const nonHeldStates = new Set([
  'overlay', 'trust-dialog', 'awaiting-user', 'auth-fail', 'rate-limit',
  'choice', 'picker', 'permission', 'compacting', 'busy', 'error',
]);
const signInTitle = '⚠ Sign-in update needed';
const signInBody = 'Your sign-in is missing permissions that are now required, so some requests may fail. Run /logout to sign in again.';
const signInBlock = new RegExp(`^[ \\t]*${signInTitle}[ \\t]*\\n[ \\t]*(?:⎿[ \\t]*)?${
  signInBody.replaceAll('.', '\\.').replaceAll(' ', '\\s+')}[ \\t]*$`, 'mu');
const signInSoftBlock = /^[ \t]*⚠[ \t]+Sign-in update needed[ \t]*\n[ \t]*[⎿└][ \t]*[^\n]*(?:\n[ \t]{2,}[^─>●○\u2800-\u28ff\n][^\n]*){0,3}/gmu;

function stripSoftNotices(text) {
  return stripAnsiAndControl(text).replace(signInBlock, '').replace(signInSoftBlock, '');
}

export function signInWarning(text) {
  const frame = stripAnsiAndControl(text);
  if (!signInBlock.test(frame)) return;
  const account = /Antigravity CLI [\d.]+[^\n]*\n[^\n]*?([\w.!+%-]+@[\w.-]+)\s+\([^\n()]+\)/i.exec(frame)?.[1];
  return { text: `${signInTitle}\n  ⎿  ${signInBody}`, ...(account && { account: account.toLowerCase() }) };
}

function rowsOf(text, keepBlanks = false) {
  const rows = stripSoftNotices(text).trimEnd().split('\n').map(line => line.trim())
    .filter(line => keepBlanks || line).slice(-32);
  while (rows.length && (modelFooter.test(rows.at(-1)) || tipFooter.test(rows.at(-1)))) rows.pop();
  return rows;
}

function inspectComposer(text) {
  const rows = stripSoftNotices(text).trimEnd().split('\n').map(line => line.trim());
  while (rows.at(-1) === '') rows.pop();
  const tail = rows.slice(-32);
  const lastRule = tail.findLastIndex(row => ruleRow.test(row));
  if (lastRule < 2) return;
  let bottom = lastRule;
  let tasks = false;
  while (bottom >= 2 && agyTaskRow.test(tail[bottom - 1] ?? '')) {
    let cursor = bottom - 1;
    while (cursor >= 0 && agyTaskRow.test(tail[cursor])) cursor--;
    if (cursor < 0 || !ruleRow.test(tail[cursor])) break;
    tasks = true;
    bottom = cursor;
  }
  if (bottom < 2 || !ruleRow.test(tail[bottom - 2])) return;
  const top = bottom - 2;
  const promptRow = tail[bottom - 1];
  const above = tail.slice(0, top).filter(row => row && !tipFooter.test(row));
  const spinnerAbove = /^[\u2800-\u28ff]/.test(above.at(-1) ?? '');
  const footer = tail.slice(lastRule + 1).filter(Boolean);
  const shortcuts = footer.filter(row => /^\? for shortcuts\b/i.test(row));
  const busy = footer.filter(row => /^esc to cancel\b/i.test(row));
  const model = footer.filter(row => modelFooter.test(row) || bareModeFooter.test(row));
  const tips = footer.filter(row => tipFooter.test(row));
  const other = footer.filter(row => !/^(?:\? for shortcuts|esc to cancel)\b/i.test(row) &&
    !modelFooter.test(row) && !bareModeFooter.test(row) && !tipFooter.test(row));
  return { promptRow, tasks, spinnerAbove, footer, shortcuts, busy, model, tips, other };
}

function hasSafeOtherFooter(other) {
  return other.length <= 3 && other.every(row =>
    !interactiveStatus.test(row) && !settingsError.test(row) && !trustFooter.test(row) && !pickerFooter.test(row));
}

export function unknownFooterHints(text) {
  const info = inspectComposer(text);
  if (!info || info.busy.length || !info.other.length || !hasSafeOtherFooter(info.other)) return [];
  if (nonHeldStates.has(classify(text))) return [];
  return info.other;
}

export function hasEmptyComposer(text) {
  const info = inspectComposer(text);
  if (!info) return false;
  if (info.busy.length) return !info.tasks && !info.other.length && composerRow.test(info.promptRow);
  if (info.shortcuts.length) return !info.other.length && composerRow.test(info.promptRow);
  if (info.spinnerAbove || info.tasks || info.promptRow !== '>') return false;
  if (!info.other.length) return !(info.model.length && !info.tips.length);
  return hasSafeOtherFooter(info.other);
}

export function hasHeldComposer(text) {
  // Agy hides the shortcuts hint while the draft has focus, and an empty
  // statusLine omits the built-in footer entirely.
  const info = inspectComposer(text);
  if (!info || info.busy.length || info.spinnerAbove || info.promptRow !== '>') return false;
  if (info.other.length && !hasSafeOtherFooter(info.other)) return false;
  return !nonHeldStates.has(classify(text));
}

function overlay(rows) {
  const lines = rows.slice(-18).map(row => row.replace(/^[│┃]\s+|\s+[│┃]$/g, '').trim());
  for (let start = 0; start < lines.length; start++) {
    if (!/^How['’]s the CLI experience so far\?/i.test(lines[start])) continue;
    for (let end = start + 1; end <= Math.min(lines.length, start + 5); end++) {
      if (survey.test(lines.slice(start, end).join(' ').replace(/\s+/g, ' '))) return { key: '0' };
    }
  }
  const tail = rows.slice(-18);
  const announcement = tail.map(row => /^[│┃]\s+(.+?)(?:\s*[│┃])?$/.exec(row)?.[1].trim());
  const title = lines.findLastIndex((line, i) => announcement[i] && announcementTitle.test(line) || autoTitle.test(line));
  if (title < 0) return;
  if (autoTitle.test(lines[title])) {
    if (!autoBody.test(lines[title + 1] ?? '')) return;
    return { id: 'auto-mode', ...(announcementDismiss.test(lines[title + 2] ?? '') && { key: 'esc' }) };
  }
  if (announcementDismiss.test(announcement[title].replace(announcementTitle, ''))) return { id: 'model-announcement', key: 'esc' };
  for (const row of announcement.slice(title + 1)) {
    if (!row) break;
    if (announcementDismiss.test(row)) return { id: 'model-announcement', key: 'esc' };
  }
}

export function startupAnnouncement(text) {
  const found = overlay(rowsOf(text));
  return found?.id ? found : undefined;
}

export function matchesPastePlaceholder(draft, text) {
  const chip = /^\[Pasted text #[1-9]\d* ([1-9]\d*) chars\]$/.exec(draft);
  return Boolean(chip && Number(chip[1]) === Array.from(text).length);
}

export function classify(text) {
  text = stripSoftNotices(text);
  const rows = rowsOf(text);
  const tail = rows.join('\n');
  const footer = rows.at(-1) ?? '';
  const state = classifyScreen('agy', text);
  if (overlay(rows)) return 'overlay';
  if (state === 'trust-dialog') return state;
  const dialog = rows.map(row => row.replace(/^[│┃]\s+|\s+[│┃]$/g, '').trim()).join('\n');
  if (/^How['’]s the CLI experience so far\?/im.test(dialog) && /\[1\][\s\S]*\[0\]/.test(dialog) ||
      /^(?:Welcome to (?:the )?Antigravity CLI|Antigravity CLI setup|Getting started with Antigravity)\s*[!.]?$/im.test(dialog) &&
      /(?:\benter\b.*\b(?:continue|confirm|select)\b|↑\/↓.*\b(?:navigate|select)\b)/i.test(dialog) ||
      /[│┃]/.test(tail) && (/^Introducing Gemini \d+\b/im.test(dialog) ||
        rows.some(row => /^[│┃]\s/.test(row) && announcementDismiss.test(row.replace(/^[│┃]\s+|\s+[│┃]$/g, ''))))) return 'awaiting-user';
  if (state === 'auth-fail' || state === 'rate-limit') return state;
  if (/^(?:Select login method:|Welcome to the Antigravity CLI\. You are currently not signed in\.)$/im.test(tail)) {
    return 'auth-fail';
  }
  if (rows.some(row => /^Question \d+\/\d+:/i.test(row)) &&
      rows.some(row => /^(?:↑\/↓ Navigate).*\besc Skip\b/i.test(row))) return 'choice';
  if (/^(?:Switch Model|Select a model:?|Choose a theme:?|Select a conversation:?|Resume Conversation)$/im.test(tail) &&
      pickerFooter.test(footer)) return 'picker';
  if (/(?:Allow once|Allow for this session|Yes, run command|Do you want to (?:allow|run)|Permission Required)/i.test(tail) &&
      /(?:enter|esc) (?:to )?(?:select|confirm|deny|cancel)\b/i.test(footer)) return 'permission';
  if (/^[\u2800-\u28ff]\s+Compacting\b/imu.test(tail)) return 'compacting';
  if (state === 'busy') return state;
  const emptyAboveSettingsError = rows.at(-3) === '>' && ruleRow.test(rows.at(-2)) && ruleRow.test(rows.at(-4));
  if (emptyAboveSettingsError && settingsError.test(footer) ||
      /^(?:⎿\s*)?(?:Error: (?:failed to|request failed)|Request failed with status [45]\d\d)\b/im.test(tail)) return 'error';
  if (hasRunningBackgroundTask(text)) return 'busy';
  if (!/^esc to cancel\b/i.test(footer) && hasEmptyComposer(text)) return 'idle';
  return 'unknown';
}

export function hasRunningBackgroundTask(text) {
  return backgroundComposer.test(rowsOf(text).join('\n')) || Boolean(inspectComposer(text)?.tasks);
}

export function dialogKeys(kind, text) {
  const rows = rowsOf(text);
  if (kind === 'overlay') {
    const key = overlay(rows)?.key;
    return key ? [key] : [];
  }
  if (kind === 'trust-dialog' && trustFooter.test(rows.at(-1) ?? '') &&
      rows.at(-2) === 'No, exit' && rows.at(-3) === '> Yes, I trust this folder' &&
      rows.some(line => line === 'Do you trust the contents of this project?')) return ['enter'];
  if (kind === 'picker' && classify(text) === 'picker') return ['esc'];
  return [];
}
