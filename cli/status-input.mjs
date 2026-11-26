import { StringDecoder } from 'node:string_decoder';

// XTerm button tracking with SGR cell coordinates. The readline escape
// parser must only receive the bytes that belong to keyboard input.
export function splitInput(keyboard, mouse, escapeKey) {
  const decoder = new StringDecoder('utf8');
  const escape = '\x1b';
  let held = '';
  let timer;
  return {
    write(chunk) {
      clearTimeout(timer);
      const text = held + decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      held = '';
      let start = 0;
      for (const match of text.matchAll(/\x1b\[<(\d{1,3});(\d{1,6});(\d{1,6})([Mm])/g)) {
        if (match.index > start) keyboard(text.slice(start, match.index));
        const [, code, x, y, ending] = match;
        mouse({ button: Number(code), x: Number(x), y: Number(y), press: ending === 'M' });
        start = match.index + match[0].length;
      }
      const tail = text.slice(start);
      const lastEscape = tail.lastIndexOf(escape);
      const suffix = lastEscape < 0 ? '' : tail.slice(lastEscape);
      if (suffix === escape || suffix === escape + '[' || /^\x1b\[<\d{0,3}(?:;\d{0,6}(?:;\d{0,6})?)?$/.test(suffix)) {
        held = suffix;
        timer = setTimeout(() => {
          const pending = held;
          held = '';
          if (pending === escape) escapeKey();
          else if (!pending.startsWith(escape + '[<')) keyboard(pending);
        }, 35);
        if (lastEscape > 0) keyboard(tail.slice(0, lastEscape));
      } else if (tail) keyboard(tail);
    },
    close() { clearTimeout(timer); },
  };
}
