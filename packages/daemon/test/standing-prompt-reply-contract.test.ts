import assert from "node:assert/strict";
import test from "node:test";
import { workerHelpTopic } from "@rah-os/agent-host";
import { nativeFinalTextInstructions } from "../../agent-host/src/final-output-instructions.js";
import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";

const compiled = () =>
  compileStandingPrompt({
    agent: { role: "File worker", instructions: "Follow the user's requests." },
    channelMemory: { section: "Channel memory is disabled." },
  }).prompt;

test("native-final standing and help select one ordinary reply path without unconditional tool-post instructions", () => {
  const prompt = nativeFinalTextInstructions(compiled(), true);
  assert.match(prompt, /Use the current wake's selected reply transport/u);
  assert.match(
    prompt,
    /Without a selected reply transport, publish with `message-post`/u,
  );
  assert.match(
    prompt,
    /wake selects native-final-text.*ordinary final assistant text/su,
  );
  assert.match(
    prompt,
    /Do not wrap it in JSON or also post that final reply through a tool/u,
  );
  for (const text of [prompt, workerHelpTopic("messages")!]) {
    assert.doesNotMatch(text, /then publish the answer with `message-post`/u);
    assert.doesNotMatch(
      text,
      /Provider prose, transcript, exit code, and session state are diagnostics only/u,
    );
    assert.doesNotMatch(
      text,
      /Provider final prose alone is not a Room reply/u,
    );
  }
  assert.match(
    workerHelpTopic("messages")!,
    /Without a selected reply transport/u,
  );
  assert.match(prompt, /Other operations retain the Worker tools/u);
  assert.match(prompt, /Task is optional durable tracking/u);
  assert.match(prompt, /memory/u);
});

test("disabled trial keeps tool-post fallback and special operations rather than enabling native-final", () => {
  const prompt = nativeFinalTextInstructions(compiled(), false);
  assert.equal(prompt, compiled());
  assert.doesNotMatch(prompt, /ordinary final assistant text is published/u);
  assert.match(
    prompt,
    /Without a selected reply transport, publish with `message-post`/u,
  );
  assert.match(
    prompt,
    /Progress, attachments and other targets use Worker tools/u,
  );
  assert.match(prompt, /With no reply needed, run `message-check` once/u);
  assert.match(prompt, /message-check first/u);
  assert.match(prompt, /never blindly resend/u);
});

test("warm scope is the current wake and explicit turn handle, not a mutable provider process environment", () => {
  const prompt = compiled();
  assert.doesNotMatch(
    prompt,
    /process\.env\.RAH_FROM_SEQ|use the current environment/u,
  );
  assert.match(prompt, /Act only on the current wake's actionable events/u);
  assert.match(
    prompt,
    /pass a wake's `--turn <handle>` to every Worker command/u,
  );
  assert.match(prompt, /earlier events are context only/u);
});
