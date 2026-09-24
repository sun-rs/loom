import assert from "node:assert/strict";
import test from "node:test";
import { workerHelpTopic } from "@rah-os/agent-host";

import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";
test("introspection guidance separates configured metadata, frozen actual Run and serving daemon from the invoked CLI carrier", () => {
  // S1-c: served on demand by `worker help profile`, named by the prompt.
  assert.match(compileStandingPrompt().prompt, /worker help <topic>.*profile/u);
  const prompt = workerHelpTopic("profile")!;
  // `profile-show` renders Raft's formatProfile, so the guidance names the
  // printed lines the Agent reads, not JSON fields it no longer receives.
  for (const word of [
    "current configuration",
    "`Latest Run`",
    "whoami",
    "serving daemon",
    "CLI carrier",
  ])
    assert.ok(prompt.includes(word), word);
  assert.match(prompt, /redacted/u);
  assert.ok(prompt.includes("More created agents:"));
  assert.ok(prompt.includes("--created-agents-cursor"));
  assert.ok(prompt.includes("`Availability` line"));
  assert.ok(!prompt.includes("createdAgentsNextCursor"));
  assert.ok(!prompt.includes("actualRun"));
});
