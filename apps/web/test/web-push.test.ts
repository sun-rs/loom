import assert from "node:assert/strict";
import test from "node:test";

import {
  applicationServerKeyBytes,
  browserPushReconciliation,
  ensureBrowserPushRegistration,
  existingBrowserPushRegistration,
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

test("Raft-style Push status reuses an existing registration without registering again", async () => {
  let registerCalls = 0;
  let updateCalls = 0;
  const registration = {
    update: async () => {
      updateCalls += 1;
      throw new Error("best-effort update failure");
    },
  };
  const serviceWorker = {
    getRegistration: async (scope: string) => {
      assert.equal(scope, "/");
      return registration;
    },
    register: async () => {
      registerCalls += 1;
      return registration;
    },
  };

  assert.equal(
    await existingBrowserPushRegistration(serviceWorker as never),
    registration,
  );
  assert.equal(registerCalls, 0);
  assert.equal(updateCalls, 1);
});

test("Raft-style Push enable registers only when no registration exists", async () => {
  let registerCalls = 0;
  const registration = { update: async () => undefined };
  const serviceWorker = {
    getRegistration: async () => undefined,
    register: async (script: string) => {
      registerCalls += 1;
      assert.equal(script, "/sw.js");
      return registration;
    },
  };

  assert.equal(
    await ensureBrowserPushRegistration(serviceWorker as never),
    registration,
  );
  assert.equal(registerCalls, 1);
});
