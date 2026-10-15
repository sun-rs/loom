import test from "node:test";
import assert from "node:assert/strict";
import { ManagementClient } from "../../frontends/raft/loom/management-client.ts";
import {
  controlChannel,
  saveConcurrency,
} from "../../frontends/raft/loom/control-actions.ts";

test("channel SOS preserves exact room, guidance and causal basis on unknown response", async () => {
  const calls: any[] = [];
  const manager = new ManagementClient(
    {
      request: async (op: string, input: any) => {
        calls.push([op, input]);
        throw Error("lost");
      },
    } as any,
    "w",
    "control",
  );
  (manager as any).session = () => ({
    syncUntilCurrent: async () => ({
      caughtUp: true,
      state: { latestRoomSeq: 17 },
    }),
  });
  await controlChannel(manager, "r", "resume", "修正方向", () => {});
  assert.equal(manager.writes.state, "unknown");
  await controlChannel(manager, "other", "stop", "", () => {});
  assert.equal(calls.length, 1);
  await manager.writes.retry();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][0], "room.sos.resume");
  assert.equal(calls[0][1].roomId, "r");
  assert.equal(calls[0][1].guidance, "修正方向");
  assert.equal(calls[0][1].basedOnRoomSeq, 17);
  manager.writes.discard();
});

test("settings writes only requested cap; unknown retry retains original revision, never overwrites newer settings", async () => {
  const calls: any[] = [];
  const manager = new ManagementClient(
    {
      request: async (op: string, input: any) => {
        calls.push([op, input]);
        throw Error("lost");
      },
    } as any,
    "w",
    "control",
  );
  await saveConcurrency(manager, 4, 3, () => {});
  await saveConcurrency(manager, 5, 9, () => {});
  assert.equal(calls.length, 1);
  await manager.writes.retry();
  assert.deepEqual(calls, [
    ["runtime.settings.update", { expectedRevision: 4, maxConcurrentRuns: 3 }],
    ["runtime.settings.update", { expectedRevision: 4, maxConcurrentRuns: 3 }],
  ]);
  manager.writes.discard();
});
