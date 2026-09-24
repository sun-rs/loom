import assert from "node:assert/strict";
import test from "node:test";

import { WORKER_HELP_TOPIC_NAMES } from "@rah-os/agent-host";

import {
  compileStandingPrompt,
  standingPromptLayers,
  type StandingPromptInput,
} from "../src/standing-prompt-compiler.ts";

/**
 * S1-c: the standing prompt is sent on every fresh session (inline in the user
 * turn for Kimi). Detail the model needs only occasionally is served on demand
 * by `worker help <topic>`; rules the code enforces are not restated as prose.
 */
// S1-g: tightened to the achieved size (max 9,832 total; platform 6,996 for
// an Agent, 7,253 on the legacy path) plus a small margin. The platform layer
// includes the byte-exact Raft memory body (3,221 chars) and its RAH bindings.
const STANDING_PROMPT_BUDGET_CHARS = 10_000;
const PLATFORM_LAYER_BUDGET_CHARS = 7_400;

const minimalInputs: readonly StandingPromptInput[] = (
  ["direct", "gated", "wait"] as const
).map((deliveryMode) => ({
  agent: { displayName: "A", handle: "a", participantId: "p", role: "R" },
  runtimeContext: { deliveryMode },
}));

test("the standing prompt for a minimal Agent stays within its character budget", () => {
  for (const input of [...minimalInputs, {}]) {
    const { prompt } = compileStandingPrompt(input);
    assert.ok(
      prompt.length <= STANDING_PROMPT_BUDGET_CHARS,
      `standing prompt is ${String(prompt.length)} chars (budget ${String(STANDING_PROMPT_BUDGET_CHARS)})`,
    );
    const platform = standingPromptLayers(input).find(
      (layer) => layer.id === "platform",
    )!;
    assert.ok(
      platform.text.length <= PLATFORM_LAYER_BUDGET_CHARS,
      `platform layer is ${String(platform.text.length)} chars (budget ${String(PLATFORM_LAYER_BUDGET_CHARS)})`,
    );
  }
});

test("the prompt no longer drives an extra turn after a successful reply", () => {
  for (const input of [...minimalInputs, {}]) {
    const { prompt } = compileStandingPrompt(input);
    assert.doesNotMatch(prompt, /and then acknowledge/u);
    assert.doesNotMatch(prompt, /separate obligation/u);
    assert.doesNotMatch(prompt, /inspect every delivered/u);
    assert.match(
      prompt,
      /Reply once with `message-post`; after a successful post your turn is done unless new work arrived\./u,
    );
  }
});

test("the prompt points at every on-demand help topic it relies on", () => {
  const { prompt } = compileStandingPrompt(minimalInputs[0]);
  const pointer =
    /Details: `"\$RAH_WORKER_CLI" worker help <topic>` — topics: ([a-z, ]+)\./u.exec(
      prompt,
    );
  assert.ok(pointer, "prompt carries the help pointer line");
  assert.deepEqual(
    pointer[1]!.split(", ").sort(),
    [...WORKER_HELP_TOPIC_NAMES].sort(),
  );
});

test("the prompt keeps the Human-decides-Tasks rule crisp", () => {
  const { prompt } = compileStandingPrompt(minimalInputs[0]);
  assert.match(prompt, /The Human decides what becomes a Task\./u);
  assert.match(
    prompt,
    /Answering a question, brief discussion, searching or reading files is a reply, not a Task: do not claim or create one for it\./u,
  );
});

test("S1-g: instructions every wake input already carries are not restated", () => {
  for (const input of [...minimalInputs, {}]) {
    const { prompt } = compileStandingPrompt(input);
    // `WAKE_CLOSING_LINE` / `ACTIVATION_FINISH_RULES` carry these each turn.
    assert.doesNotMatch(prompt, /Complete all your work before stopping/iu);
    assert.doesNotMatch(prompt, /you do not need to poll/iu);
    // The Raft memory binding already says when to read MEMORY.md.
    assert.doesNotMatch(prompt, /Read MEMORY\.md \(at process\.env/u);
  }
});
