import assert from "node:assert/strict";
import test from "node:test";
import { showLocalNotification } from "../../frontends/raft/loom/local-notifications.ts";

test("local display registers only local worker and never calls PushManager or network fetch", async (t) => {
  let shown = 0;
  let updated = false;
  t.mock.method(globalThis, "fetch", async () => {
    throw Error("external network blocked");
  });
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      serviceWorker: {
        register: async (url: string) => {
          assert.equal(url, "/loom-push-sw.js?protocol=local-v1");
          return {
            update: async () => {
              updated = true;
            },
            active: {
              postMessage: (message: any, ports: MessagePort[]) => {
                assert.equal(
                  updated,
                  true,
                  "Refresh an existing worker before sending new protocol messages",
                );
                assert.equal(message.type, "LOOM_LOCAL_NOTIFY");
                shown++;
                ports[0]!.postMessage({ ok: true });
                ports[0]!.close();
              },
            },
            pushManager: {
              subscribe: () => {
                throw Error("Push forbidden");
              },
            },
          };
        },
      },
    },
  });
  try {
    await showLocalNotification({
      version: 1,
      notificationId: "test",
      tag: "test",
      title: "test",
      body: "local",
      target: { kind: "room", roomId: "r" },
    });
    assert.equal(shown, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});
