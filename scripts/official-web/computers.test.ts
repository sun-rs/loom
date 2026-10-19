import test from "node:test";
import assert from "node:assert/strict";
import { computerStatus } from "../../frontends/raft/loom/computers.ts";
const now = Date.parse("2026-10-19T00:00:00Z");
const observation = {
  status: "online" as const,
  observedAt: new Date(now).toISOString(),
  staleAfterMs: 30000,
};
test("computer connectivity requires a fresh host observation, independent of CLI discovery", () => {
  assert.equal(computerStatus(observation, now), "online");
  assert.equal(computerStatus(observation, now + 30000), "unknown");
  assert.equal(computerStatus(undefined, now), "unknown");
  assert.equal(
    computerStatus({ ...observation, observedAt: "invalid" }, now),
    "unknown",
  );
  assert.equal(
    computerStatus({ ...observation, status: "offline" }, now),
    "offline",
  );
  assert.equal(
    computerStatus({ ...observation, status: "draining" }, now),
    "draining",
  );
});
