import assert from "node:assert/strict";
import test from "node:test";
import webPush from "web-push";
import { createNodeWebPushTransport } from "../src/web-push-administration.ts";

test("stalled provider is bounded, its sockets destroyed, and never retried", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let calls = 0,
    destroyed = false;
  t.mock.method(
    webPush,
    "sendNotification",
    (...[_s, _p, options]: Parameters<typeof webPush.sendNotification>) => {
      calls++;
      if (options?.agent)
        t.mock.method(options.agent, "destroy", () => {
          destroyed = true;
        });
      return new Promise(() => {});
    },
  );
  const pending = createNodeWebPushTransport({
    privateKey: "fake",
    publicKey: "fake",
  }).send(
    {
      endpoint: "https://push.example/fake",
      keys: { auth: "fake", p256dh: "fake" },
    },
    { title: "test" } as any,
  );
  let finished = false;
  const check = pending.catch((e) => {
    finished = true;
    assert.equal(e.code, "ETIMEDOUT");
  });
  t.mock.timers.tick(15000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(finished, true);
  await check;
  assert.equal(destroyed, true);
  assert.equal(calls, 1);
});
