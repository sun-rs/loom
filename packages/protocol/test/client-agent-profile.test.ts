import assert from "node:assert/strict";
import test from "node:test";

import { ClientAgentProfileRequestSchema } from "../src/index.ts";

const base = {
  action: "update_profile" as const,
  agentId: "agent",
  expectedRevisionId: "revision",
  basedOnRoomSeq: 0,
  idempotencyKey: "avatar-update",
  field: "avatarKey" as const,
};

test("Agent profile accepts only official or authenticated uploaded avatar keys", () => {
  assert.equal(
    ClientAgentProfileRequestSchema.safeParse({
      ...base,
      value: `upload_png_${"a".repeat(40)}`,
    }).success,
    true,
  );
  assert.equal(
    ClientAgentProfileRequestSchema.safeParse({
      ...base,
      value: "https://example.invalid/avatar.png",
    }).success,
    false,
  );
  assert.equal(
    ClientAgentProfileRequestSchema.safeParse({
      ...base,
      value: "/tmp/avatar.png",
    }).success,
    false,
  );
});
