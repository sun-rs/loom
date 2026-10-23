import assert from "node:assert/strict";
import test from "node:test";
import { setSystemNotifications } from "../../frontends/raft/loom/notification-preferences.ts";
function fixture() {
  const calls: string[] = [];
  return {
    calls,
    port: {
      requestPermission: async () => {
        calls.push("permission");
        return "granted" as NotificationPermission;
      },
      setLocal: (value: boolean) => {
        calls.push(`local:${value}`);
      },
      stopBackground: async () => {
        calls.push("stop-background");
      },
    },
  };
}
test("enabling system notifications enables local delivery without subscribing to background push", async () => {
  const f = fixture();
  await setSystemNotifications(true, f.port);
  assert.deepEqual(f.calls, ["permission", "local:true"]);
});
test("stopping system notifications stops background subscription before claiming local disabled", async () => {
  const f = fixture();
  await setSystemNotifications(false, f.port);
  assert.deepEqual(f.calls, ["stop-background", "local:false"]);
});
test("unconfirmed background stop must not report master notification switch disabled", async () => {
  const f = fixture();
  f.port.stopBackground = async () => {
    throw Error("unknown");
  };
  await assert.rejects(setSystemNotifications(false, f.port), /unknown/);
  assert.deepEqual(f.calls, []);
});
test("denied permission never enables local delivery", async () => {
  const f = fixture();
  f.port.requestPermission = async () => "denied";
  await assert.rejects(setSystemNotifications(true, f.port), /允许/);
  assert.deepEqual(f.calls, []);
});
