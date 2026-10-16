import test from "node:test";
import assert from "node:assert/strict";
import {
  BranchClient,
  branchSupported,
} from "../../frontends/raft/loom/branch-client.ts";
import { WriteIntentSlot } from "@rah-os/client-core/write-intent";
test("fork and side retain exact instance, causal basis and key after lost response", async () => {
  for (const mode of ["fork", "side"] as const) {
    const calls: any[] = [];
    let fail = true;
    const writes = new WriteIntentSlot();
    const session: any = {
      syncUntilCurrent: async () => ({
        caughtUp: true,
        state: { latestRoomSeq: 18 },
      }),
    };
    const owner = new BranchClient(
      {
        request: async (op: string, input: any) => {
          calls.push([op, input]);
          if (fail) {
            fail = false;
            throw Error("lost");
          }
          return { deduplicated: true };
        },
      } as any,
      "source",
      writes,
      session,
    );
    await owner.create("instance", mode, () => {});
    assert.equal(writes.state, "unknown");
    await writes.retry();
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(
      calls[0][0],
      mode === "fork" ? "instance.fork" : "side.create",
    );
    assert.equal(calls[0][1].basedOnRoomSeq, 18);
    assert.equal(calls[0][1].instanceId, "instance");
    assert.deepEqual(Object.keys(calls[0][1]).sort(), [
      "basedOnRoomSeq",
      "idempotencyKey",
      "instanceId",
    ]);
    writes.discard();
  }
});
test("branch capability must be explicit and match frozen runtime and channel home", () => {
  const current: any = {
    policy: { required: { allowedOfferIds: ["offer"] } },
    agent: {
      currentRevision: { executionWorkspace: { kind: "channel_home" } },
    },
  };
  const runtime: any = {
    runtimeOfferId: "offer",
    available: true,
    sessionBranches: ["fork", "side"],
  };
  assert.equal(branchSupported(current, [runtime], "side"), true);
  assert.equal(
    branchSupported(
      current,
      [{ ...runtime, sessionBranches: undefined }],
      "side",
    ),
    false,
  );
  assert.equal(
    branchSupported(
      current,
      [{ ...runtime, runtimeOfferId: "another" }],
      "fork",
    ),
    false,
  );
  assert.equal(
    branchSupported(current, [{ ...runtime, available: false }], "side"),
    false,
  );
});
test("unbound or multi-offer runtime never advertises a branch", () => {
  const current: any = {
    policy: { required: {} },
    agent: {
      currentRevision: { executionWorkspace: { kind: "channel_home" } },
    },
  };
  const runtime: any = { available: true, sessionBranches: ["fork", "side"] };
  assert.equal(branchSupported(current, [runtime], "fork"), false);
  current.policy.required.allowedOfferIds = ["one", "two"];
  assert.equal(
    branchSupported(current, [{ ...runtime, runtimeOfferId: "one" }], "side"),
    false,
  );
});
