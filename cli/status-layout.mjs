import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';

export const widthOf = stringWidth;
export const safe = value => stripVTControlCharacters(String(value ?? '')).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const graphemes = new Intl.Segmenter();
const words = new Intl.Segmenter(undefined, { granularity: 'word' });
const sgr = /(\x1b\[[\d;]+m)/;
const reset = '\x1b[0m';

/*
 * truncate and wrap adapt truncateToWidth, wrapSingleLine and breakLongWord
 * from pi-tui v0.73.1 (packages/tui/src/utils.ts). Wrapping precedes styling.
 *
 * MIT License
 *
 * Copyright (c) 2025 Mario Zechner
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export function truncate(text, width) {
  if (width <= 0) return '';
  if (widthOf(text) <= width) return text;
  const limit = width - widthOf('…');
  let kept = '';
  let used = 0;
  let styled = false;
  outer: for (const part of text.split(sgr)) {
    if (part.startsWith('\x1b')) {
      kept += part;
      styled = true;
      continue;
    }
    for (const { segment } of graphemes.segment(part)) {
      const size = widthOf(segment);
      if (used + size > limit) break outer;
      kept += segment;
      used += size;
    }
  }
  return kept + '…' + (styled ? reset : '');
}

export function pad(text, width) {
  const clipped = truncate(text, width);
  return clipped + ' '.repeat(Math.max(0, width - widthOf(clipped)));
}

export function wrap(text, width) {
  if (width <= 0) return [''];
  return String(text ?? '').split(/\r?\n/).flatMap(input => {
    const line = safe(input);
    if (widthOf(line) <= width) return [line];
    const lines = [];
    let current = '';
    let used = 0;
    function append(token) {
      const size = widthOf(token);
      if (used + size > width && current) {
        lines.push(current.trimEnd());
        current = '';
        used = 0;
      }
      if (!current && !token.trim()) return;
      current += size > width ? '…' : token;
      used += Math.min(size, width);
    }
    // Keep whitespace-separated words intact. Use word segmentation for
    // overlong runs (such as CJK prose), then fall back to whole graphemes.
    for (const token of line.trimEnd().match(/\s+|\S+/gu) ?? []) {
      if (widthOf(token) <= width) append(token);
      else if (!token.trim()) append(' ');
      else for (const { segment } of words.segment(token)) {
        if (widthOf(segment) <= width) append(segment);
        else for (const { segment: glyph } of graphemes.segment(segment)) append(glyph);
      }
    }
    return [...lines, current.trimEnd()];
  });
}

// Solars palette with nearest xterm-256 entries.
const palette = {
  accent: [174, 116, 230, 140], accentDark: [82, 62, 112, 60],
  text: [232, 228, 238, 254], muted: [156, 148, 168, 247],
  good: [92, 214, 156, 78], warn: [238, 185, 92, 222], bad: [238, 108, 112, 203],
  panel: [24, 22, 32, 234],
};

export function terminalColors(output, env = process.env) {
  if (env.NO_COLOR !== undefined || env.TERM === 'dumb') return 1;
  return /^(truecolor|24bit)$/i.test(env.COLORTERM ?? '') ? 24 : (output.getColorDepth?.(env) ?? 1);
}

export function theme(depth = 1) {
  const color = (rgb, background = false) => {
    const [r, g, b, index] = palette[rgb];
    const layer = background ? 48 : 38;
    return depth >= 24 ? `\x1b[${layer};2;${r};${g};${b}m` : `\x1b[${layer};5;${index}m`;
  };
  return (tone, text) => {
    if (depth < 8 || !text) return text;
    return tone === 'selected' ? color('panel', true) + color('accent') + text + reset : color(tone) + text + reset;
  };
}

export const row = (text = '', ...items) => ({ text, items });

export function box(title, rows, width, paint) {
  if (width < 5) return [row(truncate(title, width)), ...rows.map(line => ({ ...line, text: truncate(line.text, width) }))];
  const label = title ? ' ' + truncate(title, width - 5) + ' ' : '';
  const border = text => paint('accentDark', text);
  return [
    row(border('╭─') + paint('accent', label) + border('─'.repeat(width - 3 - widthOf(label)) + '╮')),
    ...rows.map(line => ({ ...line, text: border('│ ') + pad(line.text, width - 4) + border(' │') })),
    row(border('╰' + '─'.repeat(width - 2) + '╯')),
  ];
}

export const inside = width => width < 5 ? width : width - 4;

export function columns(width, left, right) {
  if (width < 100) return [...left(width), ...right(width)];
  const gap = 2;
  const leftWidth = Math.floor((width - gap) / 2);
  const a = left(leftWidth);
  const b = right(width - gap - leftWidth);
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) =>
    row(b[i] ? pad(a[i]?.text ?? '', leftWidth) + ' '.repeat(gap) + b[i].text : a[i].text,
      ...(a[i]?.items ?? []), ...(b[i]?.items ?? [])));
}

export function table(width, columns, entries, paint) {
  // Drop columns from the end only on terminals too narrow for their headings.
  const visible = columns.slice();
  const gap = width < 55 ? ' ' : '  ';
  while (visible.length > 1 && visible.reduce((sum, column) => sum + widthOf(column.title) + gap.length, -gap.length) > width) visible.pop();
  const widths = visible.map(column => widthOf(column.title));
  let extra = Math.max(0, width - widths.reduce((sum, size) => sum + size, gap.length * (widths.length - 1)));
  for (let i = 1; i < widths.length; i++) {
    const added = Math.min(extra, visible[i].width - widths[i]);
    widths[i] += added;
    extra -= added;
  }
  widths[0] += extra;
  const line = cells => cells.slice(0, widths.length).map((cell, i) =>
    i === widths.length - 1 ? truncate(cell, widths[i]) : pad(cell, widths[i])).join(gap);
  return [row(paint('muted', line(visible.map(column => column.title)))),
    ...entries.map(({ cells, item }) => row(line(cells), item))];
}

export function meter(percent, size, paint, { pace, tone = 'accent' } = {}) {
  const position = value => Math.round(Math.min(100, Math.max(0, value)) * size / 100);
  const filled = position(percent);
  const tick = pace == null ? -1 : Math.min(size - 1, position(pace));
  const units = (start, end) => paint(tone, '█'.repeat(Math.max(0, Math.min(end, filled) - start))) +
    paint('muted', '░'.repeat(Math.max(0, end - Math.max(start, filled))));
  const bar = tick < 0 ? units(0, size) : units(0, tick) + paint(tone, '│') + units(tick + 1, size);
  return paint('muted', '▕') + bar + paint('muted', '▏');
}

export function changedLines(previous, next) {
  let changes = '';
  for (let i = 0; i < Math.max(previous.length, next.length); i++) {
    if ((previous[i] ?? '') !== (next[i] ?? '')) changes += `\x1b[${i + 1};1H\x1b[2K${next[i] ?? ''}`;
  }
  return changes;
}
