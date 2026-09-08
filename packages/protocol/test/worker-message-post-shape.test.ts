import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkerMessagePostRequestSchema,
  WorkerMessagePostResponseSchema,
  WorkerMessageTargetConfirmationResponseSchema,
} from "../src/index.ts";

test("the Agent-facing send accepts Raft's minimal shape: a target and content", () => {
  assert.deepEqual(
    WorkerMessagePostRequestSchema.parse({
      channel: "#target",
      body: "Answer",
    }),
    { channel: "#target", body: "Answer" },
    "no basedOnRoomSeq, idempotencyKey or contextReceipt is required",
  );
  assert.deepEqual(
    WorkerMessagePostRequestSchema.parse({ body: "Answer" }),
    { body: "Answer" },
    "the originating route keeps working with content alone",
  );
  assert.deepEqual(
    WorkerMessagePostRequestSchema.parse({
      channel: "dm:@human",
      sendDraft: true,
    }),
    { channel: "dm:@human", sendDraft: true },
    "sendDraft no longer requires the model to carry a heldDraftId",
  );
  assert.deepEqual(
    WorkerMessagePostRequestSchema.parse({
      channel: "#target",
      sendDraft: true,
      anyway: true,
    }),
    { channel: "#target", sendDraft: true, anyway: true },
  );
});

test("the relaxed send schema keeps every explicit fence", () => {
  // The fully explicit form is still accepted unchanged.
  WorkerMessagePostRequestSchema.parse({
    channel: "#target",
    contextReceipt: "receipt",
    basedOnRoomSeq: 4,
    idempotencyKey: "explicit",
    body: "Answer",
  });
  assert.throws(
    () =>
      WorkerMessagePostRequestSchema.parse({
        channel: "#target",
        body: "Answer",
        unexpected: true,
      }),
    /unrecognized_keys|Unrecognized key/u,
    "the schema stays strict",
  );
  assert.throws(
    () =>
      WorkerMessagePostRequestSchema.parse({
        channel: "#target",
        sendDraft: true,
        body: "Answer",
      }),
    /must be omitted when sendDraft is true/u,
  );
  assert.throws(
    () =>
      WorkerMessagePostRequestSchema.parse({
        channel: "#target",
        sendDraft: true,
        attachmentIds: ["file-1"],
      }),
    /must be omitted when sendDraft is true/u,
  );
  assert.throws(
    () => WorkerMessagePostRequestSchema.parse({ channel: "#target" }),
    /body or attachmentIds is required/u,
  );
  assert.throws(
    () =>
      WorkerMessagePostRequestSchema.parse({
        channel: "#target",
        body: "Answer",
        anyway: true,
      }),
    /require sendDraft/u,
  );
  assert.throws(
    () =>
      WorkerMessagePostRequestSchema.parse({
        contextReceipt: "receipt",
        body: "Answer",
      }),
    /contextReceipt requires the channel/u,
  );
});

test("the thread-target confirmation refusal is a distinct, strict send response variant", () => {
  const refusal = {
    activationIds: [],
    heldDraftId: "held_draft_1",
    parentTarget: "#target",
    threadTarget: "#target:thread-1",
    threadSeq: 12,
    reason: "thread_context_target_mismatch",
    state: "target_confirmation_required",
  };
  assert.deepEqual(
    WorkerMessagePostResponseSchema.parse(refusal),
    refusal,
    "the refusal round-trips through the union next to held and mutation",
  );
  assert.deepEqual(
    WorkerMessageTargetConfirmationResponseSchema.parse(refusal),
    refusal,
  );
  assert.throws(
    () =>
      WorkerMessageTargetConfirmationResponseSchema.parse({
        ...refusal,
        recoveryTarget: "#target",
      }),
    /Unrecognized key|unrecognized_keys/u,
  );
  assert.throws(() =>
    WorkerMessageTargetConfirmationResponseSchema.parse({
      ...refusal,
      state: "held",
    }),
  );
});
