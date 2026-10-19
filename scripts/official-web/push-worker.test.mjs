import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
function setup(clients = []) {
  const handlers = {},
    shown = [],
    opened = [];
  const self = {
    location: { origin: "https://loom.test" },
    addEventListener: (k, h) => {
      handlers[k] = h;
    },
    clients: {
      matchAll: async () => clients,
      openWindow: async (url) => opened.push(url),
    },
    registration: { showNotification: async (...args) => shown.push(args) },
  };
  vm.runInNewContext(
    readFileSync("frontends/raft/loom/push-worker.js", "utf8"),
    { self, URL, URLSearchParams },
  );
  return {
    shown,
    opened,
    async emit(name, notification) {
      let work;
      handlers[name]({ ...notification, waitUntil: (p) => (work = p) });
      await work;
    },
  };
}
const payload = {
  version: 1,
  title: "Loom",
  body: "hello",
  notificationId: "n1",
  tag: "t",
  target: { kind: "message", roomId: "room1", messageId: "message1" },
};
test("worker shows canonical target and ignores malformed or foreign URL input", async () => {
  const f = setup();
  await f.emit("push", { data: { json: () => payload } });
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0][1].data.target.messageId, "message1");
  await f.emit("push", {
    data: { json: () => ({ url: "https://evil.example" }) },
  });
  assert.equal(f.shown.length, 1);
});
test("notification click creates a same-origin route, never payload URL", async () => {
  const f = setup();
  await f.emit("notificationclick", {
    notification: {
      close() {},
      data: { target: payload.target, url: "https://evil.example" },
    },
  });
  const url = new URL(f.opened[0], "https://loom.test");
  assert.equal(url.origin, "https://loom.test");
  assert.deepEqual(JSON.parse(url.searchParams.get("push")), payload.target);
});
test("native suppression respects room identity and test alwaysShow", async () => {
  const f = setup([{ url: "https://loom.test/?room=room1", focused: true }]);
  await f.emit("push", { data: { json: () => payload } });
  assert.equal(f.shown.length, 0);
  await f.emit("push", {
    data: { json: () => ({ ...payload, alwaysShow: true }) },
  });
  assert.equal(f.shown.length, 1);
});
test("same target reuses client with navigation message and focus", async () => {
  const events = [];
  const f = setup([
    {
      url: "https://loom.test/?room=room1",
      postMessage: (m) => events.push(m),
      focus: async () => events.push("focus"),
    },
  ]);
  await f.emit("notificationclick", {
    notification: { close() {}, data: { target: payload.target } },
  });
  assert.equal(f.opened.length, 0);
  assert.equal(events[0].type, "LOOM_PUSH_NAVIGATE");
  assert.equal(events[1], "focus");
});
