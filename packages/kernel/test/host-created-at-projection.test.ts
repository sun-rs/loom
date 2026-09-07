import assert from "node:assert/strict";
import test from "node:test";
import { hostProjectionFromRow } from "../src/host-projection.ts";

test("Computer creation time is durable registration time, not last heartbeat", () => {
  const row = {
    host_id: "host",
    instance_id: "new-instance",
    participant_ids_json: "[]",
    state: "online",
    created_at: "2026-01-01T00:00:00.000Z",
    last_seen_at: "2026-09-07T00:00:00.000Z",
    build_version: null,
    process_id: null,
    protocol_version: null,
  };
  assert.equal(hostProjectionFromRow(row).createdAt, row.created_at);
});
