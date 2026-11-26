import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { draftExpectation, verifyAgyDraft, verifyDraft } from './composer-draft.mjs';

// Orca b7fd7caa3, shared/agent-launch/startup/agent-prompt-injection.ts.
export const AGENT_PROMPT_BRACKETED_PASTE_START = '\x1b[200~';
export const AGENT_PROMPT_BRACKETED_PASTE_END = '\x1b[201~';
export const AGENT_PROMPT_SUBMIT = '\r';
export const AGENT_PROMPT_POST_PASTE_SUBMIT_DELAY_MS = 50;

const HELD_PROMPT_RECHECK_MS = 1000;
const DRAFT_READBACK_MS = 2200;
export const QUIET_OUTPUT_MS = 120;

const denied = outcome => ({ accepted: false, outcome });
const sameInput = (before, frame) => frame.humanSequence === before.humanSequence &&
  frame.resizeSequence === before.resizeSequence && frame.buffer === before.buffer &&
  frame.bufferSequence === before.bufferSequence;
const bracket = text => AGENT_PROMPT_BRACKETED_PASTE_START + text + AGENT_PROMPT_BRACKETED_PASTE_END;

export function agyPasteSegments(text, rows) {
  // Agy 1.5.16 folds large multiline pastes into a chip. Keep each bracketed
  // segment small enough that a shorter viewport can also show some overlap.
  const limit = Math.min(10, Math.max(1, Math.floor((rows - 10) / 2)));
  const parts = [];
  let start = 0;
  let breaks = 0;
  for (const match of text.matchAll(/\r\n?|\n/g)) {
    if (++breaks < limit) continue;
    parts.push(text.slice(start, match.index));
    start = match.index;
    breaks = 0;
  }
  return [...parts, text.slice(start)];
}

async function submitAgyComposer(text, { before, read, write, valid, verify, resume }) {
  const pastedAt = performance.now();
  const deadline = pastedAt + 15_000;
  let frame = before;
  let prefix = '';
  if (before.draft !== '' && !resume) return denied('draft-unverified');
  for (const [index, segment] of agyPasteSegments(text, before.size.rows).entries()) {
    prefix += segment;
    if (resume && index < resume.segment) continue;
    if (performance.now() >= deadline) return denied('draft-unverified');
    if (!valid(frame)) return denied('composer-changed-during-paste');
    const priorOutput = frame.outputSequence;
    const readbackDeadline = Math.min(deadline, performance.now() + DRAFT_READBACK_MS);
    const expected = draftExpectation(prefix);
    const bytes = resume?.segment === index ? Buffer.from(bracket(segment)).subarray(resume.offset) : bracket(segment);
    if (await write(bytes, frame) === false) return denied('composer-changed-during-paste');
    let matched;
    do {
      frame = await read();
      if (frame.exited || frame.humanSequence !== before.humanSequence) return denied('human-or-exit-during-paste');
      if (!sameInput(before, frame)) return denied('composer-changed-during-paste');
      if (frame.writable && frame.outputSequence > priorOutput && frame.quietForMs >= QUIET_OUTPUT_MS) {
        if (verifyAgyDraft(frame, expected, !resume || resume.ownsDraft)) {
          if (verify && !await verify(frame, { held: true })) return denied('composer-blocked-during-paste');
          if (valid(frame)) { matched = true; break; }
        }
      }
      await sleep(35);
    } while (performance.now() < readbackDeadline);
    if (!matched) return denied('draft-unverified');
  }
  if (await write(AGENT_PROMPT_SUBMIT, frame) === false) return denied('composer-changed-during-paste');
  return { accepted: true, outcome: frame.scrolledDraft ? 'verified-scrolled-draft' : 'verified-normalized-draft',
    readbackMs: Math.round(performance.now() - pastedAt) };
}

export async function submitComposer(text, options) {
  const { before, provider, pastePlaceholder, read, write, valid, verify, observeEcho } = options;
  if (provider === 'agy') return submitAgyComposer(text, options);
  if (before.draft !== '') return denied('draft-unverified');
  const pastedAt = performance.now();
  if (await write(bracket(text), before) === false) return denied('composer-changed-during-paste');
  const marker = text.split('\n', 1)[0];
  const expected = draftExpectation(text);
  const held = frame => verifyDraft(frame, expected);
  // Orca native-chat-paste-landed.ts checks a paste chip after an empty
  // composer and an unchanged reread. Claude's +N counts line breaks.
  const showsPaste = frame => !frame.outsideComposer?.includes(marker) && pastePlaceholder?.(frame.draft, text);

  // Adapted from Orca terminal-agent-prompt-submit.ts and terminal-agent-prompt-resubmit.ts.
  // Every Enter needs a current view of this draft and a check of native turn activity.
  let first;
  let previousPasteFrame;
  let collapsed;
  let normalized;
  do {
    const frame = await read();
    if (frame.exited || frame.humanSequence !== before.humanSequence) return denied('human-or-exit-during-paste');
    if (!sameInput(before, frame)) return denied('composer-changed-during-paste');
    const paste = showsPaste(frame);
    collapsed = paste && previousPasteFrame === frame.generation && frame.quietForMs >= QUIET_OUTPUT_MS;
    previousPasteFrame = paste ? frame.generation : undefined;
    normalized = frame.draft !== text;
    if (frame.writable && (collapsed || held(frame) && (!normalized || frame.quietForMs >= QUIET_OUTPUT_MS)) &&
        frame.outputSequence > before.outputSequence &&
        performance.now() - pastedAt >= AGENT_PROMPT_POST_PASTE_SUBMIT_DELAY_MS) {
      if (verify && !await verify(frame, { collapsed: Boolean(collapsed), held: normalized && !collapsed })) {
        return denied('composer-blocked-during-paste');
      }
      if (valid(frame)) { first = frame; break; }
    }
    await sleep(35);
  } while (performance.now() - pastedAt < DRAFT_READBACK_MS);
  if (!first) return denied('draft-unverified');

  const readbackMs = Math.round(performance.now() - pastedAt);
  if (collapsed || normalized) {
    if (await write(AGENT_PROMPT_SUBMIT, first) === false) return denied('composer-changed-during-paste');
    return { accepted: true, outcome: collapsed ? 'verified-collapsed-paste' : 'verified-normalized-draft', readbackMs };
  }
  const echoed = observeEcho(marker);
  if (await write(AGENT_PROMPT_SUBMIT, first) === false) return denied('composer-changed-during-paste');
  const receipt = { accepted: true, outcome: 'verified-draft', readbackMs };
  const retryAfter = performance.now() + HELD_PROMPT_RECHECK_MS;
  do {
    await sleep(100);
    const frame = await read();
    if (frame.exited || !sameInput(before, frame) || frame.draft !== text || !held(frame)) return receipt;
    if (verify && !await verify(frame)) return receipt;
    if (performance.now() < retryAfter) continue;
    // A pre-Enter paint cannot prove a prompt was held. Require a new child paint
    // of the whole draft after the write, and stop permanently on any intervening change.
    if (frame.writable && valid(frame) && echoed() && frame.outputSequence > first.outputSequence &&
        frame.quietForMs >= QUIET_OUTPUT_MS) {
      if (await write(AGENT_PROMPT_SUBMIT, frame) !== false) receipt.resubmitted = true;
    }
    return receipt;
  } while (true);
}
