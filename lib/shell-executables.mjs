import { basename } from 'node:path';

const assignment = /^[A-Za-z_]\w*=/;
const shell = /^(?:sh|bash|zsh|dash|ksh)$/;
const prefixes = new Set(['env', 'command', 'exec']);
const controlPrefix = /^(?:!|\{|if|then|elif|else|while|until|do)$/;
const separator = /[\n;&|()]/;
const wordBoundary = /[ \t\r\n;&|()<>]/;
const redirect = /(?:[0-9]+)?(?:<<<|<<-?|<>|>>|>\||[<>]&|&>>?|[<>])/y;

function executable(words, found) {
  let at = 0;
  let environment = false;
  while (at < words.length) {
    const { value, raw } = words[at++];
    if (assignment.test(environment ? value : raw ?? '')) continue;
    const name = basename(value);
    if (prefixes.has(name)) {
      environment = name === 'env';
      while (words[at]?.value.startsWith('-')) {
        const option = words[at++].value;
        if (option === '--') break;
        if (name === 'command' && /^-[pvV]*[vV][pvV]*$/.test(option)) return;
        if ((name === 'exec' && /^-[cla]*a[cla]*$/.test(option)) ||
            (environment && /^(?:-u|-C|-P|--unset|--chdir)$/.test(option))) at++;
      }
      continue;
    }
    found.push(value);
    if (shell.test(name)) {
      while (words[at]?.value.startsWith('-')) {
        const option = words[at++].value;
        if (option === '--' || option === '-') break;
        if (/^-[a-z]*c[a-z]*$/i.test(option)) {
          if (words[at]) scanShell(words[at].value, found);
          break;
        }
        if (['-o', '-O'].includes(option)) at++;
      }
    }
    return;
  }
}

// Read literal words and command boundaries without expanding variables or
// running a shell. Quoted text is data, except for nested shell expressions.
function scanShell(text, found, hereText = false) {
  let at = 0;
  const processSubstitution = () => (text[at] === '<' || text[at] === '>') && text[at + 1] === '(';

  function fragment(quote, end) {
    let result = '';
    while (at < text.length) {
      const char = text[at];
      if (quote ? char === quote : char === end || wordBoundary.test(char) && !processSubstitution()) break;
      if (!quote && (char === "'" || char === '"')) {
        at++;
        result += fragment(char);
        if (text[at] === char) at++;
      } else if (quote !== "'" && char === '\\' && at + 1 < text.length) {
        const next = text[at + 1];
        if (next !== '\n') result += quote === '"' && !'$"`\\'.includes(next) ? char + next : next;
        at += 2;
      } else if (quote !== "'" && (text.startsWith('$(', at) || char === '`' || !quote && processSubstitution())) {
        const start = at;
        const arithmetic = text.startsWith('$((', at);
        at += char === '`' ? 1 : arithmetic ? 3 : 2;
        commands(char === '`' ? '`' : ')', !arithmetic);
        if (arithmetic && text[at] === ')') at++;
        result += text.slice(start, at);
      } else {
        result += char;
        at++;
      }
    }
    return result;
  }

  function word(end) {
    const start = at;
    const value = fragment(undefined, end);
    return { value, raw: text.slice(start, at) };
  }

  function skipHereDocuments(documents) {
    for (const { delimiter, stripTabs, expand } of documents.splice(0)) {
      const body = at;
      while (at < text.length) {
        const lineStart = at;
        const lineEnd = text.indexOf('\n', at);
        const line = text.slice(at, lineEnd < 0 ? text.length : lineEnd);
        at = lineEnd < 0 ? text.length : lineEnd + 1;
        if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) {
          if (expand) scanShell(text.slice(body, lineStart), found, true);
          break;
        }
      }
    }
  }

  function commands(end, collect = true) {
    const words = [], documents = [];
    function finish() {
      if (collect) executable(words, found);
      words.length = 0;
    }
    while (at < text.length) {
      const char = text[at];
      if (char === end) { at++; break; }
      if (/[ \t\r]/.test(char)) { at++; continue; }
      if (char === '#') {
        const lineEnd = text.indexOf('\n', at);
        at = lineEnd < 0 ? text.length : lineEnd;
        continue;
      }
      redirect.lastIndex = at;
      const redirection = processSubstitution() ? undefined : redirect.exec(text)?.[0];
      if (redirection) {
        at += redirection.length;
        while (at < text.length && /[ \t]/.test(text[at])) at++;
        const { value, raw } = word(end);
        if (raw && /<<-?$/.test(redirection)) documents.push({ delimiter: value,
          stripTabs: redirection.endsWith('-'), expand: value === raw });
      } else if (separator.test(char)) {
        finish();
        at++;
        if (char === '(') commands(')', collect);
        if (char === '\n') skipHereDocuments(documents);
      } else {
        const token = word(end);
        if (!words.length && token.value === token.raw && controlPrefix.test(token.value)) continue;
        if (token.raw) words.push(token);
        else at++;
      }
    }
    finish();
  }

  if (hereText) fragment('heredoc');
  else commands();
}

export function shellExecutables(command) {
  const found = [];
  if (typeof command === 'string') scanShell(command, found);
  else if (Array.isArray(command) && command.every(value => typeof value === 'string')) {
    executable(command.map(value => ({ value })), found);
  }
  return found;
}
