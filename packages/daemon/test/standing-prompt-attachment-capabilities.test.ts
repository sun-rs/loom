import assert from "node:assert/strict";
import test from "node:test";
import { workerHelpTopic } from "@rah-os/agent-host";

import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";

test("attachment guidance asks the live owner for limits and does not imply direct cloud upload", () => {
  // S1-c: served on demand by `worker help attachments`, named by the prompt.
  assert.match(
    compileStandingPrompt().prompt,
    /worker help <topic>.*attachments/u,
  );
  const prompt = workerHelpTopic("attachments")!;
  assert.match(prompt, /attachment-capabilities/u);
  assert.match(
    prompt,
    /server-authoritative upload size and reservation lifetime/u,
  );
  // `attachment-capabilities` renders text, so the guidance states the fact
  // rather than naming a JSON field the Agent no longer receives.
  assert.match(prompt, /direct upload is disabled/iu);
  assert.ok(!prompt.includes("directUploadEnabled"));
});
