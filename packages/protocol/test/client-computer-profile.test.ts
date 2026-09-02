import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientComputerProfileUpdateRequestSchema,
  ClientComputerProfileUpdateResponseSchema,
  LocalComputerProfileSchema,
} from "../src/index.ts";

test("Computer profile protocol freezes durable identity and revision", () => {
  assert.deepEqual(
    LocalComputerProfileSchema.parse({
      description: "Local development machine",
      displayName: "Mac Studio",
      hostId: "host-local",
      revision: 2,
      updatedAt: "2026-09-02T15:30:00.000Z",
    }),
    {
      description: "Local development machine",
      displayName: "Mac Studio",
      hostId: "host-local",
      revision: 2,
      updatedAt: "2026-09-02T15:30:00.000Z",
    },
  );
  assert.throws(() =>
    LocalComputerProfileSchema.parse({
      description: null,
      displayName: "Mac Studio",
      hostId: "host-local",
      revision: 0,
      updatedAt: "2026-09-02T15:30:00.000Z",
      hostname: "must-not-be-profile-truth",
    }),
  );
});

test("Computer profile update is complete, strict and bounded", () => {
  const input = ClientComputerProfileUpdateRequestSchema.parse({
    description: null,
    displayName: "Mac Studio",
    expectedRevision: 0,
    hostId: "host-local",
    idempotencyKey: "computer-profile-1",
  });
  assert.equal(input.displayName, "Mac Studio");
  assert.throws(() =>
    ClientComputerProfileUpdateRequestSchema.parse({
      ...input,
      displayName: "   ",
    }),
  );
  assert.throws(() =>
    ClientComputerProfileUpdateRequestSchema.parse({
      ...input,
      description: "x".repeat(501),
    }),
  );
  assert.throws(() =>
    ClientComputerProfileUpdateRequestSchema.parse({
      ...input,
      expectedRevision: -1,
    }),
  );
});

test("Computer profile response carries the canonical profile and deduplication", () => {
  const response = ClientComputerProfileUpdateResponseSchema.parse({
    computer: {
      description: null,
      displayName: "Mac Studio",
      hostId: "host-local",
      revision: 1,
      updatedAt: "2026-09-02T15:30:00.000Z",
    },
    deduplicated: false,
  });
  assert.equal(response.computer.revision, 1);
  assert.equal(response.deduplicated, false);
});
