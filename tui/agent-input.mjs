import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { matchesDraft } from './pty-grid.mjs';

// Orca b7fd7caa3, shared/agent-launch/startup/agent-prompt-injection.ts.
export const AGENT_PROMPT_BRACKETED_PASTE_START = '\x1b[200~';
export const AGENT_PROMPT_BRACKETED_PASTE_END = '\x1b[201~';
export const AGENT_PROMPT_SUBMIT = '\r';
export const AGENT_PROMPT_POST_PASTE_SUBMIT_DELAY_MS = 50;

const HELD_PROMPT_RECHECK_MS = 1000;
const DRAFT_READBACK_MS = 2200;
export const QUIET_OUTPUT_MS = 120;

export async function submitComposer(text, { before, read, write, valid, verify, observeEcho }) {
  const pastedAt = performance.now();
  write(AGENT_PROMPT_BRACKETED_PASTE_START + text + AGENT_PROMPT_BRACKETED_PASTE_END);
  const sameInput = frame => frame.humanSequence === before.humanSequence &&
    frame.resizeSequence === before.resizeSequence && frame.buffer === before.buffer &&
    frame.bufferSequence === before.bufferSequence;
  const marker = text.split('\n', 1)[0];
  const held = frame => matchesDraft(frame.draft, text) && !frame.outsideComposer?.includes(marker);
  const denied = (outcome) => ({ accepted: false, outcome });

  // Adapted from Orca terminal-agent-prompt-submit.ts and terminal-agent-prompt-resubmit.ts.
  // Every Enter needs a current view of this draft and a check of native turn activity.
  let first;
  do {
    const frame = await read();
    if (frame.exited || frame.humanSequence !== before.humanSequence) return denied('human-or-exit-during-paste');
    if (!sameInput(frame)) return denied('composer-changed-during-paste');
    if (frame.writable && held(frame) && frame.outputSequence > before.outputSequence &&
        performance.now() - pastedAt >= AGENT_PROMPT_POST_PASTE_SUBMIT_DELAY_MS) {
      if (verify && !await verify(frame)) return denied('composer-blocked-during-paste');
      if (valid(frame)) { first = frame; break; }
    }
    await sleep(35);
  } while (performance.now() - pastedAt < DRAFT_READBACK_MS);
  if (!first) return denied('draft-unverified');

  const readbackMs = Math.round(performance.now() - pastedAt);
  const echoed = observeEcho(marker);
  write(AGENT_PROMPT_SUBMIT);
  const receipt = { accepted: true, outcome: 'verified-draft', readbackMs };
  const retryAfter = performance.now() + HELD_PROMPT_RECHECK_MS;
  do {
    await sleep(100);
    const frame = await read();
    if (frame.exited || !sameInput(frame) || !held(frame)) return receipt;
    if (verify && !await verify(frame)) return receipt;
    if (performance.now() < retryAfter) continue;
    // A pre-Enter paint cannot prove a prompt was held. Require a new child paint
    // of the whole draft after the write, and stop permanently on any intervening change.
    if (frame.writable && valid(frame) && echoed() && frame.outputSequence > first.outputSequence &&
        frame.quietForMs >= QUIET_OUTPUT_MS) {
      write(AGENT_PROMPT_SUBMIT);
      receipt.resubmitted = true;
    }
    return receipt;
  } while (true);
}
