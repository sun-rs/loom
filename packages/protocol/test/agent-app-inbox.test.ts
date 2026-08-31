import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentAppInboxCheckCommandSchema,
  AgentAppInboxAckCommandSchema,
  AgentAppInboxAckResultSchema,
} from "../src/agent-app-inbox.ts";

test("Computer App Inbox commands cannot override owner or business scope", () => {
  assert.deepEqual(AgentAppInboxCheckCommandSchema.parse({}), {});
  assert.deepEqual(
    AgentAppInboxAckCommandSchema.parse({ itemId: "hint-1", version: 1 }),
    { itemId: "hint-1", version: 1 },
  );
  for (const key of [
    "ownerParticipantId",
    "roomId",
    "sender",
    "toSeq",
    "runAttemptId",
  ]) {
    assert.equal(
      AgentAppInboxCheckCommandSchema.safeParse({ [key]: "other" }).success,
      false,
    );
    assert.equal(
      AgentAppInboxAckCommandSchema.safeParse({
        itemId: "hint-1",
        version: 1,
        [key]: "other",
      }).success,
      false,
    );
  }
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
    assert.equal(
      AgentAppInboxAckCommandSchema.safeParse({ itemId: "hint-1", version })
        .success,
      false,
    );
  }
  assert.equal(
    AgentAppInboxAckCommandSchema.safeParse({ itemId: "x\ny", version: 1 })
      .success,
    false,
  );
  assert.equal(
    AgentAppInboxAckResultSchema.safeParse({
      acknowledged: true,
      proofScope: "memory_cleaned",
    }).success,
    false,
  );
});
