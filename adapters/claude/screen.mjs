import { trustKeys } from '../tui-screen.mjs';

// Claude branch of /Users/sun/Code/exp-relay/orca/lib/screen.mjs.
const TAIL_LINE_LIMIT = 24;
const PROMPT_CHEVRON = '❯';

const RULE_LINE_RE = /^[─━═\-_=╭╮╰╯┌┐└┘├┤┬┴┼│┃║\s]+$/;
const URL_RE = /https?:\/\/\S+|www\.\S+/gi;
const PROSE_FOLLOW_RE =
  /^\s+(?:means|is|was|are|were|occurs?|happens?|indicates?|refers?|shows?|appears?|represents?|signifies?|denotes?)\b/i;

const UI_LEAD_RE =
  /^(?:[•●○■□▪▫◆◇▸▹►▶▻★☆✦✧✻✳✶✢✽✺✹✸✷✴✵⚠✖✗✘×✕❌⛔🚫❗⁉‼ℹ⎿└├⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷*+\-\uFE0E\uFE0F]+\s*)+/;

const ERROR_PREFIX_RE =
  /^(?:(?:\[(?:error|err|fatal|auth|api)\]\s*)|(?:(?:api|http|auth|authentication|authorization|network|request|rate[\s-]*limit|quota|grpc|server|client|model|provider|stream|fatal|unexpected|internal)\s+)*(?:error|failed|failure)\s*(?:\(\s*(?:http\s*)?\d{3}\s*\))?\s*(?::|—|–|-|\||·)\s*|(?:request\s+failed(?:\s+with(?:\s+(?:status(?:\s+code)?|http))?)?)\s*(?::|\s)\s*|(?:status(?:\s+code)?|code)\s*(?::|=)\s*)+/i;

const SOFT_WARNING_PATTERNS = [
  /\bsign-?in\s+update\s+needed\b/i,
  /\bmissing\s+permissions\b.*\bsome\s+requests\s+may\s+fail\b/i,
  /\brun\s+\/logout\s+to\s+sign\s+in\s+again\b/i,
];

const TOOL_HEADER_PATTERNS = [
  /^⏺\s+[A-Z][A-Za-z0-9_]*\s*\(/,
  /^(?:Read|Edited|Wrote|Searched|Listed)\s+\d+\s+files?\b/i,
];

const TRUST_QUESTION_PATTERNS = [
  /^quick\s+safety\s+check(?:\s*[:—–\-!]|\s*$)/i,
  /^do\s+you\s+trust\s+(?:the\s+files\s+in\s+|the\s+contents\s+of\s+)?this\s+(?:folder|directory|project|workspace)\??(?:\s|$)/i,
  /^is\s+this\s+a\s+project\s+you\s+created\s+or\s+one\s+you\s+trust\??(?:\s|$)/i,
];

const TRUST_OPTION_PATTERNS = [
  /^yes,\s*i\s+trust\s+this\s+(?:folder|directory|project|workspace)(?:\s*$|[.!,\s])/i,
];

const AUTH_FAIL_PATTERNS = [
  /^invalid\s+api\s+key\b/i,
  /^(?:please\s+)?run\s+\/login\b/i,
  /^authentication\s+failed\b/i,
  /^(?:http(?:\/\d(?:\.\d)?)?\s+)?401\s*[:\-]?\s*unauthorized\b/i,
  /^authentication_error\b/i,
  /^(?:not\s+logged\s+in|oauth\s+token\s+(?:has\s+)?expired|failed\s+to\s+authenticate)\b/i,
  /^401\s+\{.*"authentication_error"/i,
];

const RATE_LIMIT_PATTERNS = [
  /^rate[\s-]+limit\s+(?:reached|exceeded|hit)\b/i,
  /^(?:claude\s+)?usage\s+limit\s+reached\b/i,
  /^(?:5-hour|session|weekly|daily)\s+limit\s+reached\b/i,
  /^you(?:'|’)?ve\s+hit\s+your\s+(?:claude\s+)?(?:usage\s+)?limit\b/i,
  /^rate_limit_error\b/i,
  /^(?:http(?:\/\d(?:\.\d)?)?\s+)?429\s*[:\-]?\s*too\s+many\s+requests\b/i,
  /^http(?:\s+error)?\s+429\b/i,
  /^too\s+many\s+requests\b/i,
  /^429\s+\{.*"rate_limit_error"/i,
];

const ESC_TO_INTERRUPT_RE =
  /(?:^|[(\[·•|,—–]\s*|\s{2,})(?:press\s+)?esc\s+to\s+interrupt(?=$|\s*[)\]·•|—–]|\s{2,})/i;
const CLAUDE_SPINNER_RE =
  /^[✻✳✶✢✽✺✹✸✷✴✵⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷]\s+\p{L}[\p{L}' -]{1,32}(?:…|\.\.\.)(?:\s*$|\s*\(|\s*[·•|—–])/iu;

const SENTENCE_ERROR_LEAD_RE =
  /^(?:(?:your\s+)?(?:api|http|auth|authentication|request|login|session|token|oauth|account|credentials?|quota|usage|rate|claude\s+usage)\b|error\b|failed\b|unable\s+to\b|expired\b|not\s+logged\s+in\b|missing\s+api\s+key\b|invalid\b)/i;

const IDLE_PLACEHOLDER_PATTERNS = [/^try\s+["'“].+["'”]\s*$/i];

function stripAnsiAndControl(text) {
  if (typeof text !== 'string' || text.length === 0) return '';
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\x1b\][^\x07\x1b\n]*(?:\x07|\x1b\\)|\x9d[^\x07\x9c\n]*(?:\x07|\x9c)/g, '')
    .replace(/\x1b[PX^_][\s\S]*?(?:\x1b\\|\x07)/g, '')
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '')
    .replace(/[\t\u00A0\u1680\u2000-\u200A\u202F\u205F]/g, ' ');
}

function stripBoxEdges(line) {
  let out = line.trim();
  let prev;
  do {
    prev = out;
    out = out.replace(/^[│┃║┌┐└┘╭╮╰╯├┤]\s*/, '').replace(/\s*[│┃║┌┐└┘╭╮╰╯├┤]$/, '').trim();
  } while (out !== prev);
  return out;
}

function stripUrls(line) {
  return line.replace(URL_RE, '').replace(/\s{2,}/g, ' ').trim();
}

function stripUiLead(line) {
  return line.replace(UI_LEAD_RE, '').trim();
}

function stripOptionLead(line) {
  let out = stripBoxEdges(line);
  out = out.replace(/^[›❯>]\s*/, '');
  out = out.replace(/^(?:\[\d+\]|\d+[.)])\s*/, '');
  out = stripUiLead(out);
  return out;
}

function isToolHeader(trimmed) {
  const patterns = TOOL_HEADER_PATTERNS;
  return patterns.some((re) => re.test(trimmed));
}

function isSoftWarningLine(trimmed) {
  const plain = stripUiLead(stripBoxEdges(trimmed));
  return SOFT_WARNING_PATTERNS.some((re) => re.test(plain));
}

function isPromptLine(trimmed) {
  const chevron = PROMPT_CHEVRON;
  const inner = stripBoxEdges(trimmed);
  if (!inner.startsWith(chevron)) return false;
  const rest = inner.slice(chevron.length);
  return rest.length === 0 || rest.startsWith(' ');
}

function isIdlePlaceholder(promptBody) {
  const patterns = IDLE_PLACEHOLDER_PATTERNS;
  return patterns.some((re) => re.test(promptBody));
}

function matchesTrustOptionLine(trimmed) {
  const opt = stripOptionLead(stripUrls(trimmed));
  if (!opt) return false;
  const patterns = TRUST_OPTION_PATTERNS;
  return patterns.some((re) => re.test(opt));
}

function extractTailEntries(cleaned, provider) {
  const rawLines = cleaned.split('\n');
  const nonEmpty = [];
  let sawBlank = false;
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      sawBlank = true;
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    nonEmpty.push({ raw, trimmed, indent, hadBlankBefore: sawBlank });
    sawBlank = false;
  }

  const tail = nonEmpty.slice(-TAIL_LINE_LIMIT);
  let expectToolOutput = false;
  let toolChildIndent = -1;
  let inSoftWarning = false;
  let inWrappedPrompt = false;
  let wrappedPromptIndent = -1;

  return tail.map((entry) => {
    const { trimmed, indent, hadBlankBefore } = entry;
    const isRule = RULE_LINE_RE.test(trimmed);
    const isTip = /^(?:[⎿└]\s*)?tip\s*:/i.test(trimmed);
    const hasPromptChevron = isPromptLine(trimmed);
    const promptInner = hasPromptChevron ? stripBoxEdges(trimmed).slice(1).trim() : '';

    let isSoftWarning = false;
    if (isSoftWarningLine(trimmed)) {
      isSoftWarning = true;
      inSoftWarning = true;
    } else if (
      inSoftWarning &&
      !isRule &&
      !hadBlankBefore &&
      /^[⎿└]/.test(trimmed)
    ) {
      isSoftWarning = true;
    } else {
      inSoftWarning = false;
    }

    let isToolOutput = false;
    if (isToolHeader(trimmed)) {
      expectToolOutput = true;
      toolChildIndent = -1;
    } else if (/^└/.test(trimmed) || (expectToolOutput && !hadBlankBefore && /^⎿/.test(trimmed))) {
      isToolOutput = true;
      toolChildIndent = indent;
    } else if (
      toolChildIndent >= 0 &&
      !isRule &&
      !hadBlankBefore &&
      indent > toolChildIndent
    ) {
      isToolOutput = true;
    } else {
      expectToolOutput = false;
      toolChildIndent = -1;
    }

    let isWrappedUserPrompt = false;
    if (
      hasPromptChevron &&
      promptInner.length > 0 &&
      !matchesTrustOptionLine(trimmed) &&
      !isIdlePlaceholder(promptInner)
    ) {
      if (trimmed.length >= 60) {
        inWrappedPrompt = true;
        wrappedPromptIndent = indent;
      } else {
        inWrappedPrompt = false;
        wrappedPromptIndent = -1;
      }
    } else if (
      inWrappedPrompt &&
      !isRule &&
      !hadBlankBefore &&
      indent > wrappedPromptIndent &&
      !hasPromptChevron
    ) {
      isWrappedUserPrompt = true;
      if (trimmed.length < 60) {
        inWrappedPrompt = false;
        wrappedPromptIndent = -1;
      }
    } else {
      inWrappedPrompt = false;
      wrappedPromptIndent = -1;
    }

    return {
      ...entry,
      isRule,
      isTip,
      isSoftWarning,
      isToolOutput,
      hasPromptChevron,
      promptInner,
      isWrappedUserPrompt,
    };
  });
}

function getErrorCandidateClauses(entry) {
  if (
    entry.isRule ||
    entry.isTip ||
    entry.isSoftWarning ||
    entry.isToolOutput ||
    entry.hasPromptChevron ||
    entry.isWrappedUserPrompt
  ) {
    return [];
  }

  const boxed = stripBoxEdges(entry.trimmed);
  if (!boxed) return [];
  const noUrls = stripUrls(boxed);
  if (!noUrls) return [];

  const leadStripped = stripUiLead(noUrls);
  if (!leadStripped) return [];

  const candidates = new Set();
  const addVariants = (segment) => {
    const clean = segment.trim();
    if (!clean) return;
    candidates.add(clean);
    const noPrefix = clean.replace(ERROR_PREFIX_RE, '').trim();
    if (noPrefix && noPrefix !== clean) {
      candidates.add(noPrefix);
    }
  };

  addVariants(leadStripped);

  for (const part of leadStripped.split(/\s+[·•|—–]\s+/)) {
    addVariants(stripUiLead(part));
  }

  const sentences = leadStripped.split(/[.!?]\s+/);
  if (
    sentences.length >= 2 &&
    sentences.length <= 3 &&
    SENTENCE_ERROR_LEAD_RE.test(sentences[0].trim())
  ) {
    for (let i = 1; i < sentences.length; i += 1) {
      const s = sentences[i].trim();
      if (s && s.length <= 80 && !/^["'“`]/.test(s)) {
        addVariants(s);
      }
    }
  }

  return [...candidates];
}

function matchesErrorPattern(clause, pattern) {
  const match = pattern.exec(clause);
  if (!match) return false;
  const matchedText = match[0];
  if (/[:.!?—–\-·|]\s*$/.test(matchedText)) return true;
  const rest = clause.slice(matchedText.length);
  if (PROSE_FOLLOW_RE.test(rest)) return false;
  return true;
}

function matchesTrustDialog(entries) {
  const questionPatterns = TRUST_QUESTION_PATTERNS;
  for (const entry of entries) {
    if (entry.isRule || entry.isTip || entry.isSoftWarning || entry.isToolOutput || entry.isWrappedUserPrompt) {
      continue;
    }
    if (matchesTrustOptionLine(entry.trimmed)) {
      return true;
    }
    if (entry.hasPromptChevron) {
      continue;
    }
    const clean = stripUiLead(stripUrls(stripBoxEdges(entry.trimmed)));
    if (!clean) continue;
    if (questionPatterns.some((re) => matchesErrorPattern(clean, re))) {
      return true;
    }
  }
  return false;
}

function matchesError(entries, patterns) {
  for (const entry of entries) {
    const clauses = getErrorCandidateClauses(entry);
    for (const clause of clauses) {
      if (patterns.some((re) => matchesErrorPattern(clause, re))) {
        return true;
      }
    }
  }
  return false;
}

function matchesBusy(entries) {
  for (const entry of entries) {
    if (
      entry.isRule ||
      entry.isTip ||
      entry.isSoftWarning ||
      entry.isToolOutput ||
      entry.hasPromptChevron ||
      entry.isWrappedUserPrompt
    ) {
      continue;
    }

    const boxed = stripBoxEdges(entry.trimmed);
    const noUrls = stripUrls(boxed);
    if (!noUrls) continue;
    if (ESC_TO_INTERRUPT_RE.test(boxed) || CLAUDE_SPINNER_RE.test(boxed)) return true;
  }
  return false;
}

// hc supplies the grid as text without Orca's authoritative rest title.
// Claude 2.1.331 renders an empty (or suggested) composer inside two rules.
const COMPOSER_RULE = /^─{8,}$/;
const COMPOSER_FOOTER = /^(?:⚠ Transcript saving is off — |[⏵⏸]+ ?(?:bypass permissions|don't ask|accept edits|plan mode|auto mode|manual mode) on\b|[?] for shortcuts|esc to interrupt|paste again to expand$)/i;

export function hasEmptyComposer(text) {
  const rows = stripAnsiAndControl(text).split('\n').map(stripBoxEdges);
  const end = rows.findLastIndex(row => COMPOSER_RULE.test(row));
  if (end < 2 || !COMPOSER_RULE.test(rows[end - 2]) ||
      !rows.slice(end + 1).every(row => !row || COMPOSER_FOOTER.test(row))) return false;
  const input = rows[end - 1];
  return input === '❯' || (/^❯ try ["'“].+["'”]$/i.test(input) &&
    rows.slice(end + 1).some(row => /\? for shortcuts$/.test(row)));
}

// Orca b7fd7caa3: src/main/runtime/terminal/output/startup-dialog-screen.ts
const DIALOG_FOOTER_RE = /^enter to confirm · esc to cancel$/i;
const CHOICE_CURSOR_RE = /^[❯›]/;
const BYPASS_CHOICE_RE = /^yes, i accept$/i;
const DECLINE_CHOICE_RE = /^no, exit$/i;
const DIALOG_CHOICE_ROWS = 6;

// Orca b7fd7caa3: src/main/runtime/terminal/wait/startup-dialog-blocked-signals.ts
const BYPASS_HEADING_RE = /^(?:warning:\s*)?claude code running in bypass permissions mode$/i;
const STARTUP_MENU_HEADING_RE = /^(?:(?:\d+ )?new mcp servers? found|detected a custom api key|allow external claude\.md file imports)/im;
const STARTUP_MENU_FOOTER_RE = /^(?:enter to confirm · esc to cancel|space to select · esc to reject all)$/i;
const MODEL_MENU_FOOTER_RE = /^enter to set as default · s to use this session only · esc to cancel$/i;

function dialogRows(cleaned) {
  return cleaned.split('\n').map((line) => stripBoxEdges(line)).filter(Boolean);
}

function choiceKeys(rows, target) {
  if (!DIALOG_FOOTER_RE.test(rows.at(-1) ?? '')) return [];
  const choices = rows.slice(-DIALOG_CHOICE_ROWS, -1);
  const cursor = choices.findIndex((line) => CHOICE_CURSOR_RE.test(line));
  const selected = choices.findIndex((line) => target.test(stripOptionLead(line)));
  const decline = choices.findIndex((line) => DECLINE_CHOICE_RE.test(stripOptionLead(line)));
  if (cursor === -1 || selected === -1 || decline === -1 || Math.abs(selected - decline) !== 1 ||
      (cursor !== selected && cursor !== decline)) return [];
  if (cursor === selected) return ['enter'];
  return [selected > cursor ? 'down' : 'up', 'enter'];
}

function hasBypassMenu(rows) {
  return DIALOG_FOOTER_RE.test(rows.at(-1) ?? '') && rows.slice(-TAIL_LINE_LIMIT).some((row) => BYPASS_HEADING_RE.test(row));
}

function matchesPicker(rows) {
  const last = rows.at(-1) ?? '';
  const tail = rows.slice(-TAIL_LINE_LIMIT).join('\n');
  if (hasBypassMenu(rows)) return true;
  if (STARTUP_MENU_FOOTER_RE.test(last) && STARTUP_MENU_HEADING_RE.test(tail)) return true;

  // Orca b7fd7caa3: src/main/runtime/agent-state-rules/claude.json (first-run theme and login anchors).
  if (/^syntax theme: .*ctrl\+t\s*to\s*(?:disable|enable)/i.test(last)) return true;
  if (/^choose the text style that looks best.*\n[\s\S]*dark mode/im.test(tail)) return true;
  if (/^select login method:\n[\s\S]*(?:claude account with subscription|anthropic console account)/im.test(tail)) return true;

  return /^(?:select (?:a )?(?:model|effort(?: level)?)|resume (?:a )?session)\b/im.test(tail) &&
    /(?:esc\s+(?:to\s+)?(?:cancel|close|exit|back)|↑\/↓\s+to\s+(?:navigate|select))/i.test(last);
}

export function classify(text) {
  const cleaned = stripAnsiAndControl(text);
  const entries = extractTailEntries(cleaned);
  if (entries.length === 0) return 'unknown';

  const rows = dialogRows(cleaned);
  if (DIALOG_FOOTER_RE.test(rows.at(-1) ?? '') && trustKeys(rows).length) return 'trust-dialog';
  if (/^(?:Esc to cancel|Esc to deny|Enter to select|Enter to confirm)[ ·].+/i.test(rows.at(-1) ?? '') &&
      rows.some(row => /^(?:Do you want to proceed\?|Do you want to (?:allow|make)|Bash command$)/i.test(row))) return 'permission';
  if (rows.slice(-12).some(row => /^[✻✳✶✢✽✺✹✸✷✴✵]\s+Compact(?:ing|ing conversation)(?:…|\.\.\.)/i.test(row))) return 'compacting';
  if (matchesPicker(rows)) return 'picker';
  if (matchesError(entries, AUTH_FAIL_PATTERNS)) return 'auth-fail';
  if (matchesError(entries, RATE_LIMIT_PATTERNS)) return 'rate-limit';
  if (matchesBusy(entries)) return 'busy';
  if (hasEmptyComposer(text)) return 'idle';
  if (matchesTrustDialog(entries)) return 'trust-dialog';
  return 'unknown';
}

export function dialogKeys(kind, text, cwd) {
  const cleaned = stripAnsiAndControl(text);
  const rows = dialogRows(cleaned);
  if (kind === 'trust-dialog' && DIALOG_FOOTER_RE.test(rows.at(-1) ?? '') &&
      rows.some(row => /^(?:Accessing workspace:|Quick safety check:)/i.test(row))) {
    if (cwd !== undefined) {
      const heading = rows.indexOf('Accessing workspace:');
      if (heading < 0 || rows.lastIndexOf('Accessing workspace:') !== heading || rows[heading + 1] !== cwd ||
          !/^Quick safety check:/i.test(rows[heading + 2] ?? '')) return [];
    }
    return trustKeys(rows);
  }
  if (kind === 'picker' && hasBypassMenu(rows)) return choiceKeys(rows, BYPASS_CHOICE_RE);
  if (kind === 'picker' && MODEL_MENU_FOOTER_RE.test(rows.at(-1) ?? '') && rows.includes('Select model')) {
    return ['esc'];
  }
  return [];
}
