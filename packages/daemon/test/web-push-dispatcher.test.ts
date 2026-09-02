import assert from "node:assert/strict";
import test from "node:test";

import { WebPushOutboxDispatcher } from "../src/web-push-dispatcher.ts";

test("Web Push dispatcher acknowledges success and removes expired endpoints", async () => {
  const calls: string[] = [];
  let lease = true;
  const controller = new AbortController();
  const kernel = {
    leaseNextOutbox() {
      if (!lease) return null;
      lease = false;
      return {
        outboxId: "outbox-1",
        roomId: "room-1",
        roomSeq: 4,
        topic: "room.event",
        payload: {},
        createdAt: new Date().toISOString(),
        availableAtMs: 0,
        attemptCount: 1,
      };
    },
    humanNotifications: {
      webPush: {
        project() {
          return [
            {
              principalId: "human-a",
              payload: {
                version: 1 as const,
                notificationId: "n1",
                tag: "room:room-1",
                title: "Alice",
                body: "hello",
                target: { kind: "room" as const, roomId: "room-1" },
              },
            },
          ];
        },
      },
    },
    acknowledgeOutboxPublished() {
      calls.push("ack");
      controller.abort();
    },
    retryOutbox() {
      calls.push("retry");
      controller.abort();
    },
  };
  const subscriptions = {
    async list() {
      return [
        {
          endpoint: "https://push.example/live",
          keys: { auth: "a", p256dh: "p" },
        },
        {
          endpoint: "https://push.example/gone",
          keys: { auth: "a", p256dh: "p" },
        },
      ];
    },
    async remove(_principalId: string, endpoint: string) {
      calls.push(`remove:${endpoint}`);
      return true;
    },
  };
  await new WebPushOutboxDispatcher({
    dispatcherId: "push",
    kernel,
    leaseMs: 1_000,
    pollIntervalMs: 1,
    retryAfterMs: 1,
    subscriptions,
    transport: {
      async send(subscription) {
        calls.push(`send:${subscription.endpoint}`);
        if (subscription.endpoint.endsWith("gone"))
          throw Object.assign(new Error("gone"), { statusCode: 410 });
      },
    },
  }).run({ signal: controller.signal });
  assert.deepEqual(calls, [
    "send:https://push.example/live",
    "send:https://push.example/gone",
    "remove:https://push.example/gone",
    "ack",
  ]);
});
