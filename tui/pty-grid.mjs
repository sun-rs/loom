// Adapted from Orca b7fd7caa, shared/terminal/input/terminal-grid-cursor-line-context.ts
// and terminal-composer-draft.ts. Copyright (c) 2026 Lovecast Inc. See LICENSE.orca.
import { isMiniComposerFooter, miniHint } from '../adapters/opencode/index.mjs';

function undimmedText(line, cols, cell, trimRight, caret) {
  let text = '';
  let lastWritten = 0;
  for (let column = 0; line && column < Math.min(cols, line.length); column++) {
    const current = line.getCell(column, cell);
    if (!current || current.isDim() || current.getWidth() === 0) continue;
    const chars = current.getChars();
    text += chars || ' ';
    // Claude draws the end-of-draft caret as a reversed space.
    if (chars && !(column === caret && chars === ' ' && current.isInverse())) lastWritten = text.length;
  }
  return trimRight ? text.slice(0, lastWritten) : text;
}

const prompts = { claude: '❯', codex: '›', agy: '>', opencode: '┃' };
const rule = /^\s*─{8,}\s*$/;
const ruleTail = /^─+$/;
const codexFooter = /^\s*(?:gpt-\S+|o\d\S*).* [·•] /i;
const codexKeys = /^\s*← for agents · \? for shortcuts\b/i;
const agyTask = /^\s*●\s+\[\d{1,2}:\d{2}:\d{2}\]\s+\S/;
const agySuggestion = /^(?:accept-edits|plan|auto|yolo) mode: [^\n]+(?: \(shift\+tab to cycle\)|\.\.\.|…)$/i;
const openCodeRow = /^\s*┃(?: |$)/;

export function readGrid(terminal, provider, extractDraft) {
  const buffer = terminal.buffer.active;
  const cell = buffer.getNullCell();
  const lines = Array.from({ length: terminal.rows }, (_, y) => buffer.getLine(buffer.baseY + y));
  const raw = lines.map(line => line?.translateToString(true, 0, terminal.cols) ?? '');
  const text = raw.join('\n');
  const cursorY = buffer.cursorY;
  const cursor = { x: buffer.cursorX, y: cursorY };
  const prompt = prompts[provider];
  if (!prompt) return { text, cursor, draft: extractDraft?.(text) };
  let first;
  let last;
  if (provider === 'codex') {
    const hint = raw.findLastIndex(row => codexKeys.test(row));
    const status = raw.findLastIndex((row, index) => index < hint && row.trim());
    const footer = status >= 0 && / [·•] /.test(raw[status]) ? status : raw.findLastIndex(row => codexFooter.test(row));
    if (footer < 1) return { text, cursor };
    last = footer - 1;
    // Codex paints a spacer before the status row while the draft has focus.
    if (last > 0 && !raw[last].trim()) last--;
    first = raw.findLastIndex((row, index) => index <= last && !lines[index]?.isWrapped && /^\s*›(?:\s|$)/.test(row));
  } else if (provider === 'opencode') {
    const footer = raw.findLastIndex(isMiniComposerFooter);
    if (footer < 1) return { text, cursor };
    last = footer - 1;
    while (last >= 0 && !raw[last].trim()) last--;
    first = last;
    while (first >= 0 && (lines[first]?.isWrapped || openCodeRow.test(raw[first]))) first--;
    first++;
  } else {
    const ruleStart = (row, index) => rule.test(row) && (provider !== 'agy' || !lines[index]?.isWrapped);
    let bottom = raw.findLastIndex(ruleStart);
    // Agy adds a second rule below task notifications. The input is above them.
    if (provider === 'agy' && agyTask.test(raw[bottom - 1] ?? '')) {
      bottom = raw.findLastIndex((row, index) => index < bottom && ruleStart(row, index));
    }
    const top = raw.findLastIndex((row, index) => index < bottom && ruleStart(row, index) &&
      (provider === 'agy' ? /^>(?:\s|$)/.test(raw[index + 1] ?? '') : raw[index + 1]?.trimStart().startsWith(prompt)));
    if (top < 0) return { text, cursor };
    first = top + 1;
    last = bottom - 1;
  }
  if (first < 0 || last < first || !raw[first].trimStart().startsWith(prompt)) return { text, cursor };
  const rowText = index => {
    const boundary = !lines[index + 1]?.isWrapped || provider === 'opencode' && index === last;
    const line = undimmedText(lines[index], terminal.cols, cell, boundary,
      provider === 'claude' && index === cursor.y ? cursor.x : undefined);
    // OpenCode paints row fills. Claude can repaint the beginning of a
    // composer row while leaving actual spaces from the previous paint.
    // Strip that padding at hard line boundaries, keeping soft wraps intact.
    if (!boundary) return line;
    if (provider === 'claude') return line.replace(/ +$/, '');
    return provider === 'opencode' ? line.trimEnd() : line;
  };
  let draft = rowText(first).trimStart().slice(prompt.length).replace(/^[ \u00a0]/, '');
  for (let index = first + 1; index <= last; index++) {
    const line = rowText(index);
    if (lines[index]?.isWrapped) draft += line;
    // Codex paints one unindented space on a blank paragraph row.
    else if (provider === 'opencode') draft += '\n' + line.replace(/^\s*┃ ?/, '');
    else draft += '\n' + (provider === 'codex' && line === ' ' ? '' : line.replace(/^ {2}/, ''));
  }
  if (!draft.trim() || provider === 'opencode' && first === last && cursor.y === first && cursor.x <= 2 &&
      draft.trimEnd() === miniHint) draft = '';
  const firstCell = lines[first]?.getCell(2, cell);
  // Claude uses ANSI bright black for the untouched startup suggestion on some themes.
  if (provider === 'claude' && cursor.y === first && cursor.x <= 2 &&
      firstCell?.isFgPalette() && firstCell.getFgColor() === 8 && /^Try ["“].+["”]$/.test(draft)) {
    draft = '';
  }
  // agy renders the initial edit-mode suggestion in ANSI bright black at the
  // start of the live composer. Typed text does not carry this combination.
  const agyStock = provider === 'agy' && cursor.y === first && cursor.x === 2 &&
    firstCell?.isFgPalette() && firstCell.getFgColor() === 8 && agySuggestion.test(draft);
  if (agyStock) draft = '';
  // Some agy welcome paints end at the lower rule, without shortcut or
  // model text. Require the cursor and palette proof of the stock suggestion.
  let agyStartupComposer = false;
  if (agyStock && buffer.type === 'normal' && raw.slice(0, first).some(row => /\bAntigravity CLI \d+\.\d+\.\d+\b/.test(row))) {
    let after = last + 2;
    while (lines[after]?.isWrapped && ruleTail.test(raw[after])) after++;
    agyStartupComposer = raw.slice(after).every(row => !row.trim());
  }
  const stock = provider === 'claude' ? /^\s*❯\s+Try ["“].+["”]\s*$/ :
    /^\s*>\s+/;
  const recognizedStock = agyStock || stock.test(raw[first]) && (provider !== 'agy' || agySuggestion.test(raw[first].replace(stock, '')));
  const composerText = ['agy', 'claude'].includes(provider) && draft === '' && recognizedStock
    ? [...raw.slice(0, first), prompt, ...raw.slice((agyStock ? last : first) + 1)].join('\n') : text;
  const outsideComposer = [...raw.slice(0, first), ...raw.slice(last + 1)].join('\n');
  const vacantText = [...raw.slice(0, first), prompt, ...raw.slice(last + 1)].join('\n');
  const clip = provider === 'agy' && /^↑ ([1-9]\d*) more lines?\n/.exec(draft);
  const scrolledDraft = clip && cursor.y === last && { hiddenRows: Number(clip[1]), tail: draft.slice(clip[0].length) };
  const atDraftEnd = cursor.y === last &&
    !lines[last]?.translateToString(true, cursor.x, terminal.cols).trim();
  return { text, composerText, cursor, draft, outsideComposer, vacantText, scrolledDraft, atDraftEnd,
    ...(agyStartupComposer && { agyStartupComposer }) };
}
