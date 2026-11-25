// Adapted from Orca b7fd7caa, shared/terminal/input/terminal-grid-cursor-line-context.ts
// and terminal-composer-draft.ts. Copyright (c) 2026 Lovecast Inc. See LICENSE.orca.
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

const prompts = { claude: '❯', codex: '›', agy: '>' };
const rule = /^\s*─{8,}\s*$/;
const codexFooter = /^\s*(?:gpt-\S+|o\d\S*).* [·•] /i;
const codexKeys = /^\s*← for agents · \? for shortcuts\b/i;
const agyTask = /^\s*●\s+\[\d{1,2}:\d{2}:\d{2}\]\s+\S/;

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
  } else {
    let bottom = raw.findLastIndex(row => rule.test(row));
    // Agy adds a second rule below task notifications. The input is above them.
    if (provider === 'agy' && agyTask.test(raw[bottom - 1] ?? '')) {
      bottom = raw.findLastIndex((row, index) => index < bottom && rule.test(row));
    }
    const top = raw.findLastIndex((row, index) => index < bottom && rule.test(row) &&
      raw[index + 1]?.trimStart().startsWith(prompt));
    if (top < 0) return { text, cursor };
    first = top + 1;
    last = bottom - 1;
  }
  if (first < 0 || last < first || !raw[first].trimStart().startsWith(prompt)) return { text, cursor };
  const rowText = index => undimmedText(lines[index], terminal.cols, cell, !lines[index + 1]?.isWrapped,
    provider === 'claude' && index === cursor.y ? cursor.x : undefined);
  let draft = rowText(first).trimStart().slice(prompt.length).replace(/^[ \u00a0]/, '');
  for (let index = first + 1; index <= last; index++) {
    const line = rowText(index);
    if (lines[index]?.isWrapped) draft += line;
    // Codex paints one unindented space on a blank paragraph row.
    else draft += '\n' + (provider === 'codex' && line === ' ' ? '' : line.replace(/^ {2}/, ''));
  }
  if (!draft.trim()) draft = '';
  const firstCell = lines[first]?.getCell(2, cell);
  // Claude uses ANSI bright black for the untouched startup suggestion on some themes.
  if (provider === 'claude' && cursor.y === first && cursor.x <= 2 &&
      firstCell?.isFgPalette() && firstCell.getFgColor() === 8 && /^Try ["“].+["”]$/.test(draft)) {
    draft = '';
  }
  // agy renders the initial edit-mode suggestion in ANSI bright black at the
  // start of the live composer. Typed text does not carry this combination.
  if (provider === 'agy' && cursor.y === first && cursor.x === 2 &&
      firstCell?.isFgPalette() && firstCell.getFgColor() === 8 &&
      /^(?:accept-edits|plan|auto|yolo) mode: [^\n]+ \(shift\+tab to cycle\)$/i.test(draft)) {
    draft = '';
  }
  const stock = provider === 'claude' ? /^\s*❯\s+Try ["“].+["”]\s*$/ :
    /^\s*>\s+(?:accept-edits|plan|auto|yolo) mode: [^\n]+ \(shift\+tab to cycle\)$/i;
  const composerText = provider !== 'codex' && draft === '' && stock.test(raw[first])
    ? raw.map((line, index) => index === first ? prompt : line).join('\n') : text;
  const outsideComposer = [...raw.slice(0, first), ...raw.slice(last + 1)].join('\n');
  const vacantText = [...raw.slice(0, first), prompt, ...raw.slice(last + 1)].join('\n');
  return { text, composerText, cursor, draft, outsideComposer, vacantText };
}

// Orca's held-prompt guard proves the visible draft still belongs to the current request.
// The marker and every visible line must match for full-text proof.
export function matchesDraft(draft, expected) {
  return draft === expected;
}
