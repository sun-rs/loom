// Source: /Users/sun/Code/exp-relay/orca/lib/screen.mjs (loom-transcript v1).
const VALID_PROVIDERS = new Set(['codex', 'claude', 'agy']);
const TAIL_LINE_LIMIT = 24;

const BRAND_PATTERNS = [
  ['codex', /\bopenai[ ]+codex\b/i],
  ['claude', /\bclaude[ ]+code\b/i],
  ['agy', /\bantigravity[ ]+cli\b/i],
];

const PROMPT_CHEVRON = {
  codex: '›',
  claude: '❯',
  agy: '>',
};

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

const TOOL_HEADER_PATTERNS = {
  codex: [
    /^[•●]\s+(?:Ran|Explored|Edited|Created|Deleted|Read|Wrote|Searched|Called|Executed|Running)\b/,
  ],
  claude: [
    /^⏺\s+[A-Z][A-Za-z0-9_]*\s*\(/,
    /^(?:Read|Edited|Wrote|Searched|Listed)\s+\d+\s+files?\b/i,
  ],
  agy: [
    /^[●○]\s+(?:Ran|Explored|Running|Read|Edited|Wrote|Searched)\s*\(/,
    /^[●○]\s+(?:Explored|Read|Edited|Wrote|Searched)\s+\d+\s+files?\b/i,
  ],
};

const TRUST_QUESTION_PATTERNS = {
  codex: [
    /^do\s+you\s+trust\s+the\s+contents\s+of\s+this\s+directory\??(?:\s|$)/i,
    /^do\s+you\s+trust\s+(?:the\s+files\s+in\s+)?this\s+(?:directory|folder|workspace|project)\??(?:\s|$)/i,
  ],
  claude: [
    /^quick\s+safety\s+check(?:\s*[:—–\-!]|\s*$)/i,
    /^do\s+you\s+trust\s+(?:the\s+files\s+in\s+|the\s+contents\s+of\s+)?this\s+(?:folder|directory|project|workspace)\??(?:\s|$)/i,
    /^is\s+this\s+a\s+project\s+you\s+created\s+or\s+one\s+you\s+trust\??(?:\s|$)/i,
  ],
  agy: [
    /^do\s+you\s+trust\s+the\s+contents\s+of\s+this\s+(?:project|directory|folder|workspace)\??(?:\s|$)/i,
    /^do\s+you\s+trust\s+(?:the\s+files\s+in\s+)?this\s+(?:project|folder|directory|workspace)\??(?:\s|$)/i,
  ],
};

const TRUST_OPTION_PATTERNS = {
  codex: [
    /^(?:yes,\s*)?trust\s+this\s+(?:directory|folder|workspace)(?:\s*$|[.!,\s])/i,
  ],
  claude: [
    /^yes,\s*i\s+trust\s+this\s+(?:folder|directory|project|workspace)(?:\s*$|[.!,\s])/i,
  ],
  agy: [
    /^yes,\s*i\s+trust\s+this\s+(?:folder|project|directory|workspace)(?:\s*$|[.!,\s])/i,
  ],
};

const AUTH_FAIL_PATTERNS = {
  codex: [
    /^authentication\s+failed\b/i,
    /^(?:http(?:\/\d(?:\.\d)?)?\s+)?401\s*[:\-]?\s*unauthorized\b/i,
    /^http(?:\s+error)?\s+401\b/i,
    /^unauthorized\s*\(401\)/i,
    /^(?:invalid|expired)\s+(?:api\s+key|auth(?:entication)?\s+token)\b/i,
    /^failed\s+to\s+authenticate\b/i,
    /^401\s+\{.*(?:"authentication_error"|"invalid_api_key")/i,
  ],
  claude: [
    /^invalid\s+api\s+key\b/i,
    /^(?:please\s+)?run\s+\/login\b/i,
    /^authentication\s+failed\b/i,
    /^(?:http(?:\/\d(?:\.\d)?)?\s+)?401\s*[:\-]?\s*unauthorized\b/i,
    /^authentication_error\b/i,
    /^(?:not\s+logged\s+in|oauth\s+token\s+(?:has\s+)?expired|failed\s+to\s+authenticate)\b/i,
    /^401\s+\{.*"authentication_error"/i,
  ],
  agy: [
    /^(?:(?:http(?:\/\d(?:\.\d)?)?\s+)?401\s*(?:[:\-]|\()\s*)?unauthenticated\b/i,
    /^authentication\s+failed\b/i,
    /^(?:http(?:\/\d(?:\.\d)?)?\s+)?401\s*[:\-]?\s*unauthorized\b/i,
    /^invalid\s+api\s+key\b/i,
    /^failed\s+to\s+authenticate\b/i,
    /^401\s+\{.*"unauthenticated"/i,
  ],
};

const RATE_LIMIT_PATTERNS = {
  codex: [
    /^you(?:'|’)?ve\s+hit\s+your\s+usage\s+limit\b/i,
    /^http(?:\s+error)?\s+429\b/i,
    /^(?:http(?:\/\d(?:\.\d)?)?\s+)?429\s*[:\-]?\s*too\s+many\s+requests\b/i,
    /^too\s+many\s+requests\b/i,
    /^rate[\s-]+limit\s+(?:reached|exceeded|hit)\b/i,
    /^usage\s+limit\s+reached\b/i,
    /^429\s+\{.*"rate_limit/i,
  ],
  claude: [
    /^rate[\s-]+limit\s+(?:reached|exceeded|hit)\b/i,
    /^(?:claude\s+)?usage\s+limit\s+reached\b/i,
    /^(?:5-hour|session|weekly|daily)\s+limit\s+reached\b/i,
    /^you(?:'|’)?ve\s+hit\s+your\s+(?:claude\s+)?(?:usage\s+)?limit\b/i,
    /^rate_limit_error\b/i,
    /^(?:http(?:\/\d(?:\.\d)?)?\s+)?429\s*[:\-]?\s*too\s+many\s+requests\b/i,
    /^http(?:\s+error)?\s+429\b/i,
    /^too\s+many\s+requests\b/i,
    /^429\s+\{.*"rate_limit_error"/i,
  ],
  agy: [
    /^(?:(?:http(?:\/\d(?:\.\d)?)?\s+)?429\s*(?:[:\-]|\()\s*)?resource_exhausted\b/i,
    /^(?:http(?:\/\d(?:\.\d)?)?\s+)?429\s*[:\-]?\s*too\s+many\s+requests\b/i,
    /^http(?:\s+error)?\s+429\b/i,
    /^too\s+many\s+requests\b/i,
    /^rate[\s-]+limit\s+(?:reached|exceeded|hit)\b/i,
    /^quota\s+exceeded\b/i,
    /^429\s+\{.*"resource_exhausted"/i,
  ],
};

const ESC_TO_INTERRUPT_RE =
  /(?:^|[(\[·•|,—–]\s*|\s{2,})(?:press\s+)?esc\s+to\s+interrupt(?=$|\s*[)\]·•|—–]|\s{2,})/i;
const ESC_TO_CANCEL_RE =
  /(?:^|[(\[·•|,—–]\s*|\s{2,})(?:press\s+)?esc\s+to\s+cancel(?=$|\s*[)\]·•|—–]|\s{2,})/i;

const CODEX_WORKING_RE = /^working\s*\([^)]*\)(?:\s*$|\s*[·•|—–])/i;
const CLAUDE_SPINNER_RE =
  /^[✻✳✶✢✽✺✹✸✷✴✵⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷]\s+\p{L}[\p{L}' -]{1,32}(?:…|\.\.\.)(?:\s*$|\s*\(|\s*[·•|—–])/iu;
const AGY_RUNNING_RE =
  /^(?:running\s+command|thinking|working|generating|streaming|loading)(?:…|\.\.\.)(?:\s*$|\s*\(|\s*[·•|—–])/i;
const AGY_BRAILLE_SPINNER_RE =
  /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷]\s+\p{L}[\p{L}0-9' -]{1,40}(?:…|\.\.\.)(?:\s*$|\s*\(|\s*[·•|—–])/iu;

const SENTENCE_ERROR_LEAD_RE =
  /^(?:(?:your\s+)?(?:api|http|auth|authentication|request|login|session|token|oauth|account|credentials?|quota|usage|rate|claude\s+usage)\b|error\b|failed\b|unable\s+to\b|expired\b|not\s+logged\s+in\b|missing\s+api\s+key\b|invalid\b)/i;

const IDLE_PLACEHOLDER_PATTERNS = {
  codex: [/^ask\s+codex\s+to\s+do\s+anything(?:\s*$|\s*[·•|—–])/i],
  claude: [/^try\s+["'“].+["'”]\s*$/i],
  agy: [/^auto\s+mode:\s+/i],
};

export function stripAnsiAndControl(text) {
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

function isToolHeader(provider, trimmed) {
  const patterns = TOOL_HEADER_PATTERNS[provider] ?? [];
  return patterns.some((re) => re.test(trimmed));
}

function isSoftWarningLine(trimmed) {
  const plain = stripUiLead(stripBoxEdges(trimmed));
  return SOFT_WARNING_PATTERNS.some((re) => re.test(plain));
}

function isPromptLine(provider, trimmed) {
  const chevron = PROMPT_CHEVRON[provider];
  const inner = stripBoxEdges(trimmed);
  if (!inner.startsWith(chevron)) return false;
  const rest = inner.slice(chevron.length);
  return rest.length === 0 || rest.startsWith(' ');
}

function isIdlePlaceholder(provider, promptBody) {
  const patterns = IDLE_PLACEHOLDER_PATTERNS[provider] ?? [];
  return patterns.some((re) => re.test(promptBody));
}

function matchesTrustOptionLine(provider, trimmed) {
  const opt = stripOptionLead(stripUrls(trimmed));
  if (!opt) return false;
  const patterns = TRUST_OPTION_PATTERNS[provider] ?? [];
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
    const hasPromptChevron = isPromptLine(provider, trimmed);
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
    if (isToolHeader(provider, trimmed)) {
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
      !matchesTrustOptionLine(provider, trimmed) &&
      !isIdlePlaceholder(provider, promptInner)
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

function matchesTrustDialog(provider, entries) {
  const questionPatterns = TRUST_QUESTION_PATTERNS[provider] ?? [];
  for (const entry of entries) {
    if (entry.isRule || entry.isTip || entry.isSoftWarning || entry.isToolOutput || entry.isWrappedUserPrompt) {
      continue;
    }
    if (matchesTrustOptionLine(provider, entry.trimmed)) {
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

function matchesAuthFail(provider, entries) {
  const patterns = AUTH_FAIL_PATTERNS[provider] ?? [];
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

function matchesRateLimit(provider, entries) {
  const patterns = RATE_LIMIT_PATTERNS[provider] ?? [];
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

function matchesBusy(provider, entries) {
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

    if (provider === 'codex') {
      if (ESC_TO_INTERRUPT_RE.test(boxed) || CODEX_WORKING_RE.test(leadStripped)) {
        return true;
      }
    } else if (provider === 'claude') {
      if (ESC_TO_INTERRUPT_RE.test(boxed) || CLAUDE_SPINNER_RE.test(boxed)) {
        return true;
      }
    } else if (provider === 'agy') {
      if (
        ESC_TO_CANCEL_RE.test(boxed) ||
        AGY_RUNNING_RE.test(leadStripped) ||
        AGY_BRAILLE_SPINNER_RE.test(boxed)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function detectScreenProvider(text) {
  const cleaned = stripAnsiAndControl(text);
  if (!cleaned) return null;

  const matched = [];
  for (const [provider, pattern] of BRAND_PATTERNS) {
    if (pattern.test(cleaned)) {
      matched.push(provider);
    }
  }
  return matched.length === 1 ? matched[0] : null;
}

export function classifyScreen(provider, text) {
  if (!VALID_PROVIDERS.has(provider)) return 'unknown';
  const cleaned = stripAnsiAndControl(text);
  if (!cleaned) return 'unknown';

  const entries = extractTailEntries(cleaned, provider);
  if (entries.length === 0) return 'unknown';

  if (matchesTrustDialog(provider, entries)) return 'trust-dialog';
  if (matchesAuthFail(provider, entries)) return 'auth-fail';
  if (matchesRateLimit(provider, entries)) return 'rate-limit';
  if (matchesBusy(provider, entries)) return 'busy';
  return 'unknown';
}

export function parseScreen(text) {
  const provider = detectScreenProvider(text);
  const state = classifyScreen(provider, text);
  return { provider, state };
}
