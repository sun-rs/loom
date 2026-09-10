import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/components/agent-directory-pane.tsx", import.meta.url),
  "utf8",
);

test("Agent Reminder tab follows the source-backed scheduled projection and card semantics", () => {
  assert.match(source, /status: "scheduled"/u);
  assert.match(source, /relativeReminderTime\(reminder\.fireAt\)/u);
  assert.match(source, /className="rah-agent-reminder-recurrence"/u);
  assert.match(source, /className="rah-agent-reminder-reference"/u);
  assert.match(source, /onRetry/u);
  assert.doesNotMatch(source, /rah-agent-reminder-title[\s\S]*data-status/u);
  assert.match(source, /navigationSearch\(\{ target \}\)/u);
  assert.match(source, /<a[\s\S]*rah-agent-reminder-reference/u);
  assert.match(source, /threadId: reminder\.threadId/u);
  assert.match(source, /rootMessageId: reminder\.rootMessageId/u);
});

test("empty Reminder view explains how to create one through Agent conversation", () => {
  assert.match(source, /此 Agent 尚未安排任何提醒/);
  assert.match(source, /明天提醒我跟进/);
});
