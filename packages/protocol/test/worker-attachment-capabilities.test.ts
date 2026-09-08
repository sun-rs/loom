import assert from "node:assert/strict";
import test from "node:test";
import * as P from "../src/index.ts";

test("upload capability queries accept no authority or transport override", () => {
  assert.deepEqual(
    P.WorkerAttachmentUploadCapabilitiesRequestSchema.parse({}),
    {},
  );
  for (const raw of [
    { roomId: "room" },
    { actorId: "human" },
    { directUploadEnabled: true },
  ])
    assert.equal(
      P.WorkerAttachmentUploadCapabilitiesRequestSchema.safeParse(raw).success,
      false,
    );
  const valid = {
    directUploadEnabled: false,
    directUploadThresholdBytes: null,
    maxBytes: P.MAX_ATTACHMENT_BYTES,
    sessionExpiresInSeconds: 3600,
  };
  assert.deepEqual(
    P.WorkerAttachmentUploadCapabilitiesResponseSchema.parse(valid),
    valid,
  );
  for (const raw of [
    { ...valid, directUploadEnabled: true },
    { ...valid, directUploadThresholdBytes: 123 },
    { ...valid, maxBytes: 0 },
    { ...valid, maxBytes: P.MAX_ATTACHMENT_BYTES + 1 },
    { ...valid, sessionExpiresInSeconds: 0 },
    { ...valid, uploadUrl: "https://example.invalid" },
  ])
    assert.equal(
      P.WorkerAttachmentUploadCapabilitiesResponseSchema.safeParse(raw).success,
      false,
    );
});
