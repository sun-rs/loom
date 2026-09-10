import assert from "node:assert/strict";
import test from "node:test";

import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";

/**
 * The tool contract now reports outcomes the old prompt summarised away: a
 * nonzero exit that still queued the message, and a Task hold that reading can
 * clear. A tool that reports partial success is worthless if the prompt tells
 * the model to read it as total failure.
 */
test("the prompt explains a result by effect and code, never by exit status alone", () => {
  const prompt = compileStandingPrompt().prompt;
  assert.doesNotMatch(
    prompt,
    /a nonzero exit is never a delivery/u,
    "MENTION_DELIVERY_FAILED exits nonzero with the message already queued",
  );
  assert.match(prompt, /Effect: message_queued/u);
  assert.match(prompt, /MENTION_DELIVERY_FAILED/u);
  assert.match(prompt, /do not resend it/u);
  // --json prints nothing on stdout for a partial result, so silence there
  // must not be read as proof that nothing was sent.
  assert.match(
    prompt,
    /an empty stdout does not by itself mean nothing was sent/u,
  );
});

test("the prompt states what reading clears and what it never grants", () => {
  const prompt = compileStandingPrompt().prompt;
  assert.match(
    prompt,
    /never grant Room membership, Task ownership or execution authority/u,
  );
  assert.match(prompt, /stops being held once you have read that same fact/u);
  assert.match(
    prompt,
    /Reading something else, however recent, does not clear it/u,
    "a larger sequence read elsewhere is not proof of the blocking fact",
  );
  // A RAH adaptation must be marked as one rather than presented as upstream.
  assert.match(prompt, /RAH's own adaptation, not an upstream behaviour/u);
  // The old instruction to simply wait for a follow-up must not survive next
  // to the new one, or the two contradict each other.
  assert.match(prompt, /rerun the same command if it is still correct/u);
});
