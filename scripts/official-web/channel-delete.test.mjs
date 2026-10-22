import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("channel delete binds existing versioned intent and native confirmation, never a second endpoint", () => {
  const source = readFileSync(
    "frontends/raft/loom/ChannelDeleteAction.tsx",
    "utf8",
  );
  assert.match(source, /OfficialConfirmation.generated/);
  assert.match(source, /submitRevisioned/);
  assert.match(source, /request\("room.delete"/);
  assert.match(source, /basedOnRoomSeq: basis/);
  assert.match(source, /syncUntilCurrent/);
  assert.match(source, /eligibility !== "clear"/);
  assert.match(source, /room.slug === "all"/);
  assert.doesNotMatch(source, /fetch\(/);
});
