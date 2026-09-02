import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientPushSubscribeRequestSchema,
  WebPushPayloadSchema,
} from "../src/index.ts";

test("Web Push contracts reject insecure endpoints and arbitrary navigation URLs", () => {
  const subscription = {
    endpoint: "https://push.example/subscription",
    keys: { auth: "auth_key", p256dh: "public_key" },
  };
  assert.equal(
    ClientPushSubscribeRequestSchema.parse({ subscription }).subscription
      .endpoint,
    subscription.endpoint,
  );
  assert.throws(() =>
    ClientPushSubscribeRequestSchema.parse({
      subscription: { ...subscription, endpoint: "http://push.example/x" },
    }),
  );
  assert.throws(() =>
    WebPushPayloadSchema.parse({
      version: 1,
      notificationId: "n1",
      tag: "room-r1",
      title: "Alice",
      body: "hello",
      target: { url: "https://evil.example" },
    }),
  );
  assert.equal(
    WebPushPayloadSchema.parse({
      version: 1,
      notificationId: "n1",
      tag: "room-r1",
      title: "Alice",
      body: "hello",
      target: { kind: "message", roomId: "room-1", messageId: "message-1" },
    }).target.kind,
    "message",
  );
});
