import { trustKeys } from '../tui-screen.mjs';

// Source: /Users/sun/Code/exp-relay/orca/lib/screen.mjs, Codex recognition and shared screen parsing.
const TAIL_LINE_LIMIT = 24;

const PROMPT_CHEVRON = '›';

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
  /^[•●]\s+(?:Ran|Explored|Edited|Created|Deleted|Read|Wrote|Searched|Called|Executed|Running)\b/,
];

const TRUST_QUESTION_PATTERNS = [
  /^do\s+you\s+trust\s+the\s+contents\s+of\s+this\s+directory\??(?:\s|$)/i,
  /^do\s+you\s+trust\s+(?:the\s+files\s+in\s+)?this\s+(?:directory|folder|workspace|project)\??(?:\s|$)/i,
];

const TRUST_OPTION_PATTERNS = [
  /^(?:yes,\s*)?trust\s+this\s+(?:directory|folder|workspace)(?:\s*$|[.!,\s])/i,
];

// Orca b7fd7caa3 src/main/runtime/terminal/output/startup-dialog-screen.ts.
// Include the footer shown by Codex 0.171.0 when opening a new Git workspace.
const TRUST_DIALOG_FOOTER_RE = /^enter(?: to)? (?:continue|confirm)\s*·\s*esc (?:back|quit|cancel)$/i;
const TRUST_DIALOG_CHOICE_RE = /^(?:[❯›]\s*)?(?:\d+\.\s*)?(?:yes, i trust this folder|trust and continue)$/i;

// Orca b7fd7caa3 src/main/runtime/terminal/wait/startup-dialog-blocked-signals.ts.
const CODEX_MODEL_MIGRATION_KEY_ROW_RE = /enter\/esc\s*(?:continue|confirm)\s*·/i;
const CODEX_UPDATE_KEY_ROW_RE = /^enter\s*continue\s*·\s*esc\s*skip\s*$/i;
const UPDATE_HEADING = /^(?:codex just got an upgrade|update available|upgrade available)\b/i;
const RESUME_DIRECTORY = /^(?:choose working directory to (?:resume|continue)|(?:this )?session (?:was|is) (?:originally )?(?:started|created) in a different (?:working )?directory|resume (?:this )?session (?:in|from) a different (?:working )?directory)\b/i;
const CODEX_STARTUP_HOOKS_KEY_ROW_RE = /^enter\s*confirm\s*·(?!\s*esc\s*back\b)/i;
const PICKER_KEY_ROW_RE = /^enter(?: to)?\s*(?:select|confirm|continue)\s*·\s*esc\s*(?:back|skip|cancel)$/i;
const PICKER_HEADING_RE = /^(?:select (?:a )?(?:model|reasoning (?:effort|level)|session|conversation)|(?:resume|fork) (?:a |an )?(?:previous )?(?:session|conversation)|choose working directory to|codex just got an upgrade|update available|hooks need review)\b/i;

const AUTH_FAIL_PATTERNS = [
  /^authentication\s+failed\b/i,
  /^(?:http(?:\/\d(?:\.\d)?)?\s+)?401\s*[:\-]?\s*unauthorized\b/i,
  /^http(?:\s+error)?\s+401\b/i,
  /^unauthorized\s*\(401\)/i,
  /^(?:invalid|expired)\s+(?:api\s+key|auth(?:entication)?\s+token)\b/i,
  /^failed\s+to\s+authenticate\b/i,
  /^401\s+\{.*(?:"authentication_error"|"invalid_api_key")/i,
  /^unexpected status 401\b/i,
  /^missing environment variable\b.*(?:\b|_)api[_ ]key\b/i,
];

const RATE_LIMIT_PATTERNS = [
  /^you(?:'|’)?ve\s+hit\s+your\s+usage\s+limit\b/i,
  /^http(?:\s+error)?\s+429\b/i,
  /^(?:http(?:\/\d(?:\.\d)?)?\s+)?429\s*[:\-]?\s*too\s+many\s+requests\b/i,
  /^too\s+many\s+requests\b/i,
  /^rate[\s-]+limit\s+(?:reached|exceeded|hit)\b/i,
  /^usage\s+limit\s+reached\b/i,
  /^429\s+\{.*"rate_limit/i,
  /^unexpected status 429\b/i,
  /^exceeded retry limit, last status: 429\b/i,
  // Orca b7fd7caa3 src/main/runtime/__fixtures__/codex-model-capacity.txt.
  /^selected model is at capacity\b/i,
];

const ESC_TO_INTERRUPT_RE =
  /(?:^|[(\[·•|,—–]\s*|\s{2,})(?:press\s+)?esc\s+to\s+interrupt(?=$|\s*[)\]·•|—–]|\s{2,})/i;

const CODEX_WORKING_RE = /^working\s*\([^)]*\)(?:\s*$|\s*[·•|—–])/i;

const SENTENCE_ERROR_LEAD_RE =
  /^(?:(?:your\s+)?(?:api|http|auth|authentication|request|login|session|token|oauth|account|credentials?|quota|usage|rate|claude\s+usage)\b|error\b|failed\b|unable\s+to\b|expired\b|not\s+logged\s+in\b|missing\s+api\s+key\b|invalid\b)/i;

const IDLE_PLACEHOLDER_PATTERNS = [/^ask\s+codex\s+to\s+do\s+anything(?:\s*$|\s*[·•|—–])/i];

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
  return TOOL_HEADER_PATTERNS.some((re) => re.test(trimmed));
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
  return IDLE_PLACEHOLDER_PATTERNS.some((re) => re.test(promptBody));
}

function matchesTrustOptionLine(trimmed) {
  const opt = stripOptionLead(stripUrls(trimmed));
  if (!opt) return false;
  return TRUST_OPTION_PATTERNS.some((re) => re.test(opt));
}

function extractTailEntries(cleaned) {
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
  const footer = entries.at(-1).trimmed;
  if (TRUST_DIALOG_FOOTER_RE.test(footer) &&
    entries.slice(-6, -1).some(entry => TRUST_DIALOG_CHOICE_RE.test(entry.trimmed))) return true;

  if (entries.some(entry => entry.hasPromptChevron &&
    (entry.promptInner === '' || isIdlePlaceholder(entry.promptInner)))) return false;
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
    if (TRUST_QUESTION_PATTERNS.some((re) => matchesErrorPattern(clean, re))) {
      return true;
    }
  }
  return false;
}

function matchesPicker(entries) {
  const footer = entries.at(-1).trimmed;
  const heading = entries.some(entry => !entry.isToolOutput && !entry.hasPromptChevron && PICKER_HEADING_RE.test(entry.trimmed));
  // Orca startup-dialog-blocked-signals.ts. These complete last key rows
  // survive Codex's character-diff redraw even when its title is fragmented.
  return CODEX_MODEL_MIGRATION_KEY_ROW_RE.test(footer) || CODEX_UPDATE_KEY_ROW_RE.test(footer) ||
    heading && (PICKER_KEY_ROW_RE.test(footer) || /^enter default · s session · esc back$/i.test(footer) || CODEX_STARTUP_HOOKS_KEY_ROW_RE.test(footer));
}

function matchesAuthFail(entries) {
  for (const entry of entries) {
    const clauses = getErrorCandidateClauses(entry);
    for (const clause of clauses) {
      if (AUTH_FAIL_PATTERNS.some((re) => matchesErrorPattern(clause, re))) {
        return true;
      }
    }
  }
  return false;
}

function matchesRateLimit(entries) {
  for (const entry of entries) {
    const clauses = getErrorCandidateClauses(entry);
    for (const clause of clauses) {
      if (RATE_LIMIT_PATTERNS.some((re) => matchesErrorPattern(clause, re))) {
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
    const leadStripped = stripUiLead(noUrls);

    if (ESC_TO_INTERRUPT_RE.test(boxed) || CODEX_WORKING_RE.test(leadStripped)) {
      return true;
    }
  }
  return false;
}

// Orca b7fd7caa3: src/main/runtime/agent-state-rules/codex-screen-predicates.ts.
// The live placeholder, adjacent status row and provisional header checks are
// paired with 0.171's keyboard hints, which disappear when a draft has focus.
const CODEX_EMPTY_COMPOSER_RE = /^\u203A ask codex to do anything\s*$/;
const CODEX_BUSY_STATUS_MARKER = 'to interrupt)';
const CODEX_STATUS_TIP_PREFIX = '└ tip:';
const CODEX_HEADER_LOADING_RE = /(?:model|directory):\s+loading|^\s*loading\s*$/m;
// Orca b7fd7caa3, shared/agent-status/output/codex-native-notice.ts.
const CAPACITY_NOTICE = /^[\u25A0\u26A0]\s+Selected model is at capacity\. Please try a different model\.$/;
const RECONNECT_FAILED_NOTICE = '\u25A0 Automatic reconnect could not restore this session.';

function currentNotice(entries) {
  const composer = entries.findLastIndex(entry => entry.hasPromptChevron);
  if (composer < 0) return;
  const above = entries.slice(0, composer);
  let notice = '';
  for (let index = above.length - 1; index >= 0 && notice.length < 160; index--) {
    const entry = above[index];
    notice = `${entry.trimmed} ${notice}`.trim();
    if (!entry.isToolOutput && CAPACITY_NOTICE.test(notice)) return 'rate-limit';
  }
  if (above.some((entry, index) => entry.raw.startsWith('\u25A0 ') &&
      above.slice(index, index + 8).map(row => row.trimmed).join(' ').replace(/\s+/g, ' ').startsWith(RECONNECT_FAILED_NOTICE))) {
    return 'error';
  }
}

function hasBusyStatusRowAbove(lines, composer) {
  const above = lines.slice(0, composer).filter((line) => line.trim() !== '');
  const row = above.at(-1)?.trimStart().startsWith(CODEX_STATUS_TIP_PREFIX)
    ? above.at(-2)
    : above.at(-1);
  return row?.includes(CODEX_BUSY_STATUS_MARKER) ?? false;
}

export function hasEmptyComposer(text) {
  const lines = stripAnsiAndControl(text).toLowerCase().split('\n');
  const composer = lines.findLastIndex(line => CODEX_EMPTY_COMPOSER_RE.test(line));
  if (composer === -1 || CODEX_HEADER_LOADING_RE.test(lines.join('\n'))) return false;
  const after = lines.slice(composer + 1).map(line => line.trim()).filter(Boolean);
  return after.length === 2 && /^.+ · .+$/.test(after[0]) && /^← for agents · \? for shortcuts/.test(after[1]);
}

export function classify(text) {
  const cleaned = stripAnsiAndControl(text);
  if (!cleaned) return 'unknown';

  const entries = extractTailEntries(cleaned);
  if (entries.length === 0) return 'unknown';

  if (matchesTrustDialog(entries)) return 'trust-dialog';
  const footer = entries.at(-1).trimmed;
  if (CODEX_UPDATE_KEY_ROW_RE.test(footer) || entries.some(entry => !entry.isToolOutput && !entry.hasPromptChevron &&
      (UPDATE_HEADING.test(entry.trimmed) || RESUME_DIRECTORY.test(entry.trimmed))) &&
      /\b(?:enter|esc)\b.*\b(?:continue|confirm|select|skip|back|cancel)\b/i.test(footer)) return 'awaiting-user';
  if (matchesPicker(entries)) return 'picker';
  if (/(?:^|\| )enter to submit answer(?:\s*\||$)/i.test(footer) &&
      entries.some(entry => /^(?:[›> ]*)\d+[.)]\s+/.test(entry.trimmed))) return 'choice';
  const tail = entries.map(entry => entry.trimmed).join('\n');
  // Orca b7fd7caa3: src/main/runtime/agent-state-rules/codex.json, plan_implement_menu.
  if (/implement this plan\?[\s\S]*no,\s*stay\s*in\s*plan\s*mode[\s\S]*enter\s*select\s*·\s*esc\s*back\s*$/i.test(tail) ||
      /^(?:Would you like to run|Do you want to run|Select Approval Mode|Update Model Permissions)\b/im.test(tail) &&
      /(?:esc|escape) (?:to )?(?:cancel|back|deny)\s*$/i.test(tail)) return 'permission';

  // The last chevron belongs to the composer. Earlier user rows delimit visible turns.
  const composer = entries.findLastIndex(entry => entry.hasPromptChevron);
  const user = entries.findLastIndex((entry, index) => entry.hasPromptChevron && index < composer);
  const compacted = entries.findLastIndex(entry => /^[•]\s+Context compacted · /i.test(entry.trimmed));
  const current = entries.slice(Math.max(user, compacted, 0));
  if (matchesAuthFail(current)) return 'auth-fail';
  const notice = currentNotice(current);
  if (notice) return notice;
  if (matchesRateLimit(current)) return 'rate-limit';
  if (current.some(entry => /^(?:[•■]\s*)?Compact(?:ing|ing context)\b/i.test(entry.trimmed))) return 'compacting';
  if (matchesBusy(current) || hasBusyStatusRowAbove(entries.map(entry => entry.trimmed.toLowerCase()), composer)) return 'busy';
  if (current.some(entry => !entry.isToolOutput && (/^■\s+(?:unexpected status [45]\d\d|error:|failed to connect)/i.test(entry.trimmed) ||
      /^■\s+\{"type":"error","error":\{/.test(entry.raw)))) return 'error';
  if (hasEmptyComposer(text)) return 'idle';
  return 'unknown';
}

export function dialogKeys(kind, text) {
  const entries = extractTailEntries(stripAnsiAndControl(text));
  const rows = entries.map(entry => entry.trimmed);
  if (kind === 'trust-dialog' && TRUST_DIALOG_FOOTER_RE.test(rows.at(-1) ?? '') &&
      rows.some(row => /^(?:Folder access|Trust this folder\?)/i.test(row))) return trustKeys(rows);
  if (kind === 'picker' && entries.length && matchesPicker(entries) &&
      (/esc (?:back|cancel)$/i.test(rows.at(-1)) || CODEX_UPDATE_KEY_ROW_RE.test(rows.at(-1)))) return ['esc'];
  return [];
}
