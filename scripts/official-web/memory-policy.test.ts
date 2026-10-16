import test from "node:test";
import assert from "node:assert/strict";
import {
  MemoryPolicyClient,
  policyPatch,
} from "../../frontends/raft/loom/memory-policy.ts";
const policy: any = {
  channelId: "room",
  revision: 8,
  readDefault: true,
  writeDefault: true,
  overrides: [
    { instanceId: "old", read: false, write: null },
    { instanceId: "a", read: true, write: null },
  ],
  members: [{ instanceId: "a", read: true, write: true }],
};
test("policy patch preserves omitted former members and represents inherit as null", () => {
  assert.equal(policyPatch(policy, { ...policy }), null);
  const patch = policyPatch(policy, {
    ...policy,
    readDefault: false,
    overrides: [{ instanceId: "a", read: null, write: false }],
  });
  assert.deepEqual(patch, {
    channelId: "room",
    expectedRevision: 8,
    readDefault: false,
    overrides: [{ instanceId: "a", read: null, write: false }],
  });
});
test("policy unknown result preserves exact request and revision", async () => {
  const calls: any[] = [];
  let fail = true;
  const owner = new MemoryPolicyClient({
    request: async (op: any, input: any) => {
      calls.push([op, input]);
      if (fail) {
        fail = false;
        throw Error("lost");
      }
      return {};
    },
  } as any);
  await owner.save(policy, { ...policy, writeDefault: false }, () => {});
  assert.equal(owner.writes.state, "unknown");
  await owner.writes.retry();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][1].expectedRevision, 8);
  owner.writes.discard();
});
