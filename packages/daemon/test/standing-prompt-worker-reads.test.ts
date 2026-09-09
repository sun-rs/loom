import assert from "node:assert/strict";
import test from "node:test";
import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";

test("standing prompt teaches source-backed read-before-answer and task-board deduplication without granting writes", () => {
  const prompt = compileStandingPrompt().prompt;
  for (const command of [
    "message-read",
    "message-resolve",
    "room-members",
    "server-info",
    "profile-show",
    "task-list",
    "task-history",
  ])
    assert.ok(prompt.includes(command), command);
  assert.match(prompt, /Read tools do not acknowledge Inbox/u);
  assert.match(prompt, /Before calling `task-create`, check `task-list`/u);
});

test("standing prompt exposes ordinary attachments without requiring a Task", () => {
  const prompt = compileStandingPrompt().prompt;
  for (const command of [
    "attachment-publish",
    "attachment-download",
    "attachment-cancel",
    "--attachment-ids",
  ])
    assert.ok(prompt.includes(command), command);
  assert.match(prompt, /Ordinary message attachments do not require a Task/u);
});

test("standing prompt distinguishes creating pending Tasks from claiming and limits assignment to idle creator work", () => {
  const prompt = compileStandingPrompt().prompt;
  assert.ok(prompt.includes("task-convert"));
  assert.ok(prompt.includes("task-assign"));
  assert.match(prompt, /Conversion does not claim the Task/u);
  assert.match(prompt, /Only manage assignments of Tasks you created/u);
});

test("self-profile prompt requires read revision context and distinguishes profile changes from execution configuration", () => {
  const prompt = compileStandingPrompt().prompt;
  assert.ok(prompt.includes("profile-self-get"));
  assert.ok(prompt.includes("profile-update"));
  assert.ok(prompt.includes("profile-avatar-publish"));
  assert.match(prompt, /never silently replace its expected revision/u);
});

test("parent continuation waits for the next Activation after explicit unblock", () => {
  const prompt = compileStandingPrompt().prompt;
  assert.ok(prompt.includes("task-unblock"));
  assert.match(prompt, /next Activation delivers `task.unblocked`/u);
});

test("amendment prompt uses channel-member metadata authority without granting Task ownership", () => {
  const prompt = compileStandingPrompt().prompt;
  assert.match(prompt, /task-amend/u);
  assert.match(prompt, /current Room member/u);
  assert.match(prompt, /metadata does not claim/u);
  assert.match(prompt, /before\/after/u);
});

test("channel mute guidance distinguishes ordinary Activity, direct obligations, followed Threads and execution cursors", () => {
  const prompt = compileStandingPrompt().prompt;
  assert.ok(prompt.includes("channel-mute"));
  assert.ok(prompt.includes("channel-unmute"));
  assert.match(prompt, /personal @mentions and DMs still arrive/u);
  assert.match(prompt, /does not stop the Agent/u);
  assert.match(prompt, /Task execution cursor/u);
});

test("joined-target reads and search guidance never confer cross-Room write authority", () => {
  const prompt = compileStandingPrompt().prompt;
  for (const command of [
    "room-list",
    "room-resolve",
    "message-search",
    "--sender",
    "--sort",
  ])
    assert.ok(prompt.includes(command), command);
  assert.match(prompt, /already joined Rooms and DMs/u);
  assert.match(prompt, /does not authorize cross-Room writes/u);
});

test("Task deletion prompt distinguishes metadata removal from execution cancellation", () => {
  const prompt = compileStandingPrompt().prompt;
  // Raft addresses the Task by channel and number; the Room is implied.
  assert.match(prompt, /task-delete --target "#channel" --number N/u);
  assert.match(prompt, /Only delete Tasks you created/u);
  assert.match(
    prompt,
    /preserves the source Message, Thread and published files/u,
  );
  assert.match(prompt, /does not cancel running execution/u);
});

test("standing prompt explains target upload ownership and cross-Run held receipts", () => {
  const prompt = compileStandingPrompt().prompt;
  assert.match(
    prompt,
    /attachment-publish --target TARGET --context-receipt RECEIPT/u,
  );
  assert.match(prompt, /a later Run must obtain a new target receipt/u);
  assert.doesNotMatch(
    prompt,
    /Cross-target attachment publication and held-draft resending remain unavailable/u,
  );
});

/**
 * Ported from agent-prompt-compiler.js lines 166-197 and 272: the Agent is
 * taught the address a Human reads and the suffix that shows it.
 */
test("the standing prompt teaches Raft's Task addressing and the [task #N ...] suffix", () => {
  const prompt = compileStandingPrompt().prompt;
  assert.match(prompt, /\[task #3 status=in_progress\]/u);
  assert.match(
    prompt,
    /if a message was later converted to a Task, it will show the `\[task #N \.\.\.\]` suffix/u,
  );
  assert.match(
    prompt,
    /If a message already shows a `\[task #N \.\.\.\]` suffix, claim `#N` if it is yours to take/u,
  );
  assert.match(prompt, /task-claim --target "#channel" --number 1 --number 2/u);
  assert.match(prompt, /In prose always write "task #N", not bare "#N"/u);
  // `--task-id` stays accepted but is no longer the form the Agent is taught.
  assert.doesNotMatch(prompt, /task-claim --task-id/u);
});
