import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { summarizeChatRequest } from "./chat-request-evidence.mjs";

const body = (messages, extra = {}) =>
  Buffer.from(JSON.stringify({ model: "fake-local", messages, ...extra }));

test("archives are summarized without exposing prompts or estimating tokens", () => {
  const bytes = body([
    { role: "system", content: "PRIVATE_SYSTEM" },
    { role: "user", content: "处理账单 🧾" },
  ]);
  const result = summarizeChatRequest(bytes, { currentTask: "处理账单 🧾" });
  assert.equal(result.bodyBytes, bytes.length);
  assert.equal(
    result.bodySha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(result.latestUser.currentTaskOccurrences, 1);
  assert.equal(
    result.systemSha256,
    createHash("sha256")
      .update(JSON.stringify([{ role: "system", content: "PRIVATE_SYSTEM" }]))
      .digest("hex"),
  );
  assert.equal(JSON.stringify(result).includes("PRIVATE_SYSTEM"), false);
  assert.equal(JSON.stringify(result).includes("处理账单"), false);
  assert.equal("inputTokens" in result, false);
});

test("prior user history is distinguished from duplicate injection in a new wake", () => {
  const history = [
    { role: "user", content: "first unique task" },
    {
      role: "assistant",
      content: "previous final",
      reasoning_content: "THINK",
    },
  ];
  const options = {
    currentTask: "second unique task",
    earlierTasks: ["first unique task"],
  };
  const normal = summarizeChatRequest(
    body([...history, { role: "user", content: "wake: second unique task" }]),
    options,
  );
  assert.deepEqual(normal.latestUser.earlierTaskOccurrences, [0]);
  assert.equal(normal.reasoningCharacters, 5);
  assert.equal(normal.messageCount, 3);
  const duplicate = summarizeChatRequest(
    body([
      ...history,
      {
        role: "user",
        content: "first unique task; second unique task; second unique task",
      },
    ]),
    options,
  );
  assert.deepEqual(duplicate.latestUser.earlierTaskOccurrences, [1]);
  assert.equal(duplicate.latestUser.currentTaskOccurrences, 2);
});

test("settings and tool hashes expose configuration changes independently of history", () => {
  const messages = [{ role: "user", content: "a task" }];
  const extra = {
    tools: [{ type: "function", function: { name: "read" } }],
    thinking: { effort: "low" },
  };
  const first = summarizeChatRequest(body(messages, extra));
  const later = summarizeChatRequest(
    body([...messages, { role: "assistant", content: "done" }], extra),
  );
  assert.equal(first.settingsSha256, later.settingsSha256);
  assert.equal(first.toolsSha256, later.toolsSha256);
  assert.notEqual(first.messagesSha256, later.messagesSha256);
  const changed = summarizeChatRequest(
    body(messages, { ...extra, thinking: { effort: "high" } }),
  );
  assert.notEqual(first.settingsSha256, changed.settingsSha256);
});

test("a trailing CLI reminder is not mistaken for a missing business request", () => {
  const result = summarizeChatRequest(
    body([
      { role: "user", content: "wake: actual task" },
      { role: "user", content: "automatic permission reminder" },
    ]),
    { currentTask: "actual task" },
  );
  assert.equal(result.latestUser.currentTaskOccurrences, 0);
  assert.deepEqual(result.currentTaskUserMessages, [
    { index: 0, occurrences: 1 },
  ]);
  assert.equal(result.currentTaskOccurrencesInUserMessages, 1);
});

test("unsupported content remains explicit instead of proving complete text coverage", () => {
  const result = summarizeChatRequest(
    body([
      {
        role: "user",
        content: [
          { type: "text", text: "task" },
          { type: "image_url", image_url: { url: "PRIVATE_IMAGE" } },
        ],
      },
    ]),
    { currentTask: "task" },
  );
  assert.equal(result.textClassificationComplete, false);
  assert.equal(result.latestUser.currentTaskOccurrences, 1);
  assert.equal(JSON.stringify(result).includes("PRIVATE_IMAGE"), false);
});

test("invalid bytes, JSON and unsupported request envelopes fail without leaking content", () => {
  for (const bytes of [
    Buffer.from([0xff]),
    Buffer.from("PRIVATE_INVALID"),
    Buffer.from('{"messages":[]}'),
  ]) {
    assert.throws(
      () => summarizeChatRequest(bytes),
      /^Error: Unsupported chat request evidence$/,
    );
  }
  assert.throws(() =>
    summarizeChatRequest(body([{ role: "user", content: "x" }]), {
      currentTask: "",
    }),
  );
});
