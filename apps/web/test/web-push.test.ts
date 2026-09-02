import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationServerKeyBytes,
  browserPushReconciliation,
  readBrowserPushPreference,
  writeBrowserPushPreference,
} from "../src/web-push-client.ts";
import {
  pushTargetFromSearch,
  pushTargetSearch,
} from "../src/push-navigation.ts";

test("Push targets serialize only into typed same-origin product routes", () => {
  assert.equal(
    pushTargetSearch({
      kind: "message",
      roomId: "room one",
      messageId: "message+1",
      threadId: "thread-a",
      rootMessageId: "root&1",
    }),
    "?target=message&room=room+one&message=message%2B1&threadId=thread-a&thread=room+one%3Aroot%261",
  );
  assert.deepEqual(
    pushTargetFromSearch(
      pushTargetSearch({
        kind: "message",
        roomId: "room one",
        messageId: "message+1",
        threadId: "thread-a",
        rootMessageId: "root&1",
      }),
    ),
    {
      kind: "message",
      roomId: "room one",
      messageId: "message+1",
      threadId: "thread-a",
      rootMessageId: "root&1",
    },
  );
  assert.deepEqual([...applicationServerKeyBytes("AQIDBA")], [1, 2, 3, 4]);
});

test("Web Push is desired by default but an explicit device opt-out persists", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  assert.equal(readBrowserPushPreference(storage), true);
  writeBrowserPushPreference(storage, false);
  assert.equal(readBrowserPushPreference(storage), false);
  writeBrowserPushPreference(storage, true);
  assert.equal(readBrowserPushPreference(storage), true);
});

test("default Web Push reconciliation requests once on gesture and never revives opt-out", () => {
  assert.equal(
    browserPushReconciliation({
      browserSubscribed: false,
      desired: true,
      permission: "default",
      supported: true,
    }),
    "request_on_gesture",
  );
  assert.equal(
    browserPushReconciliation({
      browserSubscribed: false,
      desired: true,
      permission: "granted",
      supported: true,
    }),
    "subscribe",
  );
  assert.equal(
    browserPushReconciliation({
      browserSubscribed: true,
      desired: false,
      permission: "granted",
      supported: true,
    }),
    "unsubscribe",
  );
  assert.equal(
    browserPushReconciliation({
      browserSubscribed: false,
      desired: true,
      permission: "denied",
      supported: true,
    }),
    "none",
  );
});
