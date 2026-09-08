import assert from "node:assert/strict";
import test from "node:test";
import { WorkerSelfProfileUpdateRequestSchema } from "../src/worker-self-profile.ts";
test("Worker self profile edits bind explicit profile causal position and reject broader authority", () => {
  const request = {
    writeContext: {
      controlRoomId: "control",
      controlRoomSeq: 7,
      expectedRevisionId: "revision",
    },
    idempotencyKey: "edit",
    patch: { displayName: " New ", description: " " },
  };
  const parsed = WorkerSelfProfileUpdateRequestSchema.parse(request);
  assert.equal(parsed.patch.displayName, "New");
  assert.equal(parsed.patch.description, "");
  for (const extra of [
    { target: "other" },
    { basedOnRoomSeq: 7 },
    { handle: "other" },
    { role: "admin" },
    { model: "new" },
  ])
    assert.equal(
      WorkerSelfProfileUpdateRequestSchema.safeParse({ ...request, ...extra })
        .success,
      false,
    );
  for (const patch of [
    {},
    { role: "other" },
    { avatarKey: "https://example.test/avatar.png" },
    { avatarUploadIntentId: "only" },
  ])
    assert.equal(
      WorkerSelfProfileUpdateRequestSchema.safeParse({ ...request, patch })
        .success,
      false,
    );
  assert.equal(
    WorkerSelfProfileUpdateRequestSchema.safeParse({
      ...request,
      writeContext: {
        controlRoomId: "control",
        expectedRevisionId: "revision",
      },
    }).success,
    false,
  );
});
