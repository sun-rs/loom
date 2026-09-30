import assert from "node:assert/strict";
import test from "node:test";

import { workerHelpTopic } from "@rah-os/agent-host";

import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";

/**
 * The tool contract now reports outcomes the old prompt summarised away: a
 * nonzero exit that still queued the message, and a Task hold that reading can
 * clear. A tool that reports partial success is worthless if the prompt tells
 * the model to read it as total failure.
 */
test("the prompt follows error recovery output; on-demand help explains partial results", () => {
  const prompt = compileStandingPrompt().prompt;
  // S1-c: the standing prompt keeps the rule; the full error contract lives in
  // `worker help errors`, which the prompt names.
  const errors = workerHelpTopic("errors")!;
  for (const text of [prompt, errors]) {
    assert.doesNotMatch(
      text,
      /a nonzero exit is never a delivery/u,
      "MENTION_DELIVERY_FAILED exits nonzero with the message already queued",
    );
  }
  assert.match(
    prompt,
    /On errors follow the printed Effect and Next action; never blindly resend/u,
  );
  assert.match(errors, /Effect: message_queued/u);
  assert.match(errors, /do not resend it/u);
  assert.match(errors, /Effect: not_sent/u);
  assert.match(prompt, /worker help <topic>.*errors/u);
  assert.match(errors, /MENTION_DELIVERY_FAILED/u);
  // --json prints nothing on stdout for a partial result, so silence there
  // must not be read as proof that nothing was sent.
  assert.match(
    errors,
    /an empty stdout does not by itself mean nothing was sent/u,
  );
});

test("on-demand reading help states what reading clears and what it never grants", () => {
  const prompt = compileStandingPrompt().prompt;
  assert.match(prompt, /worker help <topic>.*history/u);
  // S1-c: the hold-clearing mechanics are served by `worker help history`
  // and `worker help tasks`; the held command output itself names what to read.
  const history = workerHelpTopic("history")!;
  const tasks = workerHelpTopic("tasks")!;
  assert.match(
    history,
    /never grant Room membership, Task ownership or execution authority/u,
  );
  assert.match(history, /stops being held once you have read that same fact/u);
  assert.match(
    history,
    /Reading something else, however recent, does not clear it/u,
    "a larger sequence read elsewhere is not proof of the blocking fact",
  );
  // A RAH adaptation must be marked as one rather than presented as upstream.
  assert.match(history, /RAH's own adaptation, not an upstream behaviour/u);
  // The old instruction to simply wait for a follow-up must not survive next
  // to the new one, or the two contradict each other.
  assert.match(tasks, /rerun the same command if it is still correct/u);
});
