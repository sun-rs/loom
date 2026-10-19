import assert from "node:assert/strict";
import test from "node:test";
import { LoomPushClient } from "../../frontends/raft/loom/push-client.ts";
function fixture() {
  let stored = false,
    local = true,
    lost = false,
    failRead = false,
    removed = 0,
    permissionCalls = 0;
  const calls: string[] = [];
  const subscription = {
    endpoint: "https://push.example/current",
    toJSON: () => ({
      expirationTime: null,
      endpoint: "https://push.example/current",
      keys: { auth: "auth", p256dh: "key" },
    }),
    unsubscribe: async () => {
      removed++;
      local = false;
      return true;
    },
  };
  const client = {
    request: async (op: string, input: any) => {
      calls.push(op);
      if (op === "push.configuration") {
        if (failRead) throw Error("read lost");
        return {
          supported: true,
          applicationServerKey: "key",
          subscriptionCount: 6,
          ...(input.endpoint ? { subscribed: stored } : {}),
        };
      }
      if (op === "push.subscribe") {
        stored = true;
        if (lost) throw Error("response lost");
        return { subscribed: true };
      }
      if (op === "push.unsubscribe") {
        stored = false;
        if (lost) throw Error("response lost");
        return { subscribed: false };
      }
      if (op === "push.test") {
        if (lost) throw Error("response lost");
        return { delivered: 2 };
      }
    },
  };
  const platform = {
    permission: () => "granted",
    requestPermission: async () => {
      permissionCalls++;
      return "granted";
    },
    existing: async () => (local ? subscription : null),
    subscribe: async () => {
      local = true;
      return subscription;
    },
  };
  return {
    bridge: new LoomPushClient(client as any, platform as any),
    calls,
    get removed() {
      return removed;
    },
    get permissionCalls() {
      return permissionCalls;
    },
    set lost(v: boolean) {
      lost = v;
    },
    set failRead(v: boolean) {
      failRead = v;
    },
  };
}
test("current endpoint read does not infer registration from total count", async () => {
  const f = fixture();
  assert.equal((await f.bridge.read()).subscribed, false);
  assert.equal(f.permissionCalls, 0);
});
test("lost subscribe and unsubscribe are verified, never resent", async () => {
  const f = fixture();
  f.lost = true;
  assert.equal((await f.bridge.enable()).subscribed, true);
  assert.equal(f.calls.filter((x) => x === "push.subscribe").length, 1);
  await f.bridge.disable();
  assert.equal(f.removed, 1);
  assert.equal(f.calls.filter((x) => x === "push.unsubscribe").length, 1);
});
test("unknown unsubscribe retains browser endpoint for explicit recovery", async () => {
  const f = fixture();
  await f.bridge.enable();
  f.lost = true;
  f.failRead = true;
  await assert.rejects(f.bridge.disable());
  assert.equal(f.removed, 0);
});
test("test notification failure is not silently retried", async () => {
  const f = fixture();
  await f.bridge.enable();
  f.lost = true;
  await assert.rejects(f.bridge.test());
  assert.equal(f.calls.filter((x) => x === "push.test").length, 1);
});
