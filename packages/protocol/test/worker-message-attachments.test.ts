import assert from "node:assert/strict";
import test from "node:test";
import {
  WorkerMessageAttachmentPrepareRequestSchema,
  WorkerMessageAttachmentUploadSchema,
  WorkerMessagePostRequestSchema,
} from "../src/index.ts";

test("discussion upload contract never accepts Task, Room or actor selection", () => {
  const base = {
    filename: "picture.png",
    mimeType: "image/png",
    size: 12,
    idempotencyKey: "upload",
  };
  assert.deepEqual(
    WorkerMessageAttachmentPrepareRequestSchema.parse(base),
    base,
  );
  for (const key of ["roomId", "taskId", "participantId", "actorId"])
    assert.equal(
      WorkerMessageAttachmentPrepareRequestSchema.safeParse({
        ...base,
        [key]: "injected",
      }).success,
      false,
    );
  assert.equal(
    WorkerMessageAttachmentUploadSchema.safeParse({
      filename: "picture.png",
      mimeType: "image/png",
      size: 12,
      attachmentId: "a",
      roomId: "r",
      state: "completed",
      expiresAt: "2026-09-08T01:00:00.000Z",
      sha256: "a".repeat(64),
    }).success,
    true,
  );
});
test("attachment-only replies are explicit and held drafts cannot replace their saved attachments", () => {
  const base = { basedOnRoomSeq: 1, idempotencyKey: "post" };
  assert.equal(
    WorkerMessagePostRequestSchema.safeParse({ ...base, attachmentIds: ["a"] })
      .success,
    true,
  );
  assert.equal(
    WorkerMessagePostRequestSchema.safeParse({ ...base, attachmentIds: [] })
      .success,
    false,
  );
  assert.equal(
    WorkerMessagePostRequestSchema.safeParse({
      ...base,
      sendDraft: true,
      heldDraftId: "held",
      attachmentIds: ["replacement"],
    }).success,
    false,
  );
  assert.equal(
    WorkerMessagePostRequestSchema.safeParse({
      ...base,
      body: "x",
      attachmentIds: Array.from({ length: 11 }, (_, i) => String(i)),
    }).success,
    false,
  );
});
