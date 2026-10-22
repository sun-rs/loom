import test from "node:test";
import assert from "node:assert/strict";
import type { RahClient } from "@rah-os/client-sdk";
import { readCurrentChannelMembers } from "../../frontends/raft/loom/current-channel-members.ts";
test("current membership replaces removed rows and resolves new identities without history replay or ACK", async () => {
  const old = { principalId: "old", kind: "agent" as const, handle: "Old" },
    fresh = { principalId: "new", kind: "agent" as const, handle: "New" };
  const calls: Array<{ method: string; input: unknown }> = [];
  const client = {
    request: async (method: string, input: unknown) => {
      calls.push({ method, input });
      if (method === "room.member.list")
        return { memberships: [{ principalId: "new" }] };
      if (method === "room.sync") return { snapshot: { members: [fresh] } };
      throw Error("unexpected " + method);
    },
  } as unknown as RahClient;
  assert.deepEqual(await readCurrentChannelMembers(client, "room", [old]), [
    fresh,
  ]);
  assert.deepEqual(
    calls.map((c) => c.method),
    ["room.member.list", "room.sync"],
  );
  assert.deepEqual(calls[1].input, {
    roomId: "room",
    consumerId: "loom-member-identities:room",
    bootstrap: "latest",
    limit: 1,
  });
  calls.length = 0;
  assert.deepEqual(await readCurrentChannelMembers(client, "room", [fresh]), [
    fresh,
  ]);
  assert.equal(calls.length, 1);
});
test("missing latest identity fails visibly instead of claiming a current roster", async () => {
  const client = {
    request: async (method: string) =>
      method === "room.member.list"
        ? { memberships: [{ principalId: "new" }] }
        : { snapshot: null },
  } as unknown as RahClient;
  await assert.rejects(
    () => readCurrentChannelMembers(client, "room", []),
    /unavailable/,
  );
});
