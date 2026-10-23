import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
function setup(clients = [], receipts = new Map(), showNotification) {
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
    registration: {
      showNotification: async (...args) => {
        await showNotification?.(...args);
        shown.push(args);
      },
    },
  };
  const cache = {
    match: async (k) => receipts.get(k),
    put: async (k, v) => receipts.set(k, v),
    keys: async () => [...receipts.keys()],
    delete: async (k) => receipts.delete(k),
  };
  vm.runInNewContext(
    readFileSync("frontends/raft/loom/push-worker.js", "utf8"),
    {
      self,
      URL,
      URLSearchParams,
      Response,
      caches: { open: async () => cache },
    },
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

test("local and remote delivery share one receipt and one notification", async () => {
  const f = setup();
  const replies = [];
  await f.emit("message", {
    source: { url: "https://loom.test/" },
    data: { type: "LOOM_LOCAL_NOTIFY", payload },
    ports: [{ postMessage: (r) => replies.push(r) }],
  });
  await f.emit("push", { data: { json: () => payload } });
  assert.equal(f.shown.length, 1);
  assert.equal(replies.at(-1).ok, true);
});
test("local notification rejects foreign source without displaying", async () => {
  const f = setup();
  await f.emit("message", {
    source: { url: "https://evil.test/" },
    data: { type: "LOOM_LOCAL_NOTIFY", payload },
    ports: [],
  });
  assert.equal(f.shown.length, 0);
});

test("local source rejection returns a failure receipt instead of silently timing out", async () => {
  const f = setup();
  const replies = [];
  await f.emit("message", {
    source: null,
    data: { type: "LOOM_LOCAL_NOTIFY", payload },
    ports: [{ postMessage: (r) => replies.push(r) }],
  });
  assert.equal(replies[0]?.ok, false);
  assert.equal(replies[0]?.error, "source");
  assert.equal(f.shown.length, 0);
});

// Browser lifecycle coverage: every setup creates a fresh JS worker, while only
// CacheStorage survives. There is no Window client or local polling producer.
test("closed-page push survives worker restart and click reopens its target", async () => {
  const receipts = new Map();
  const first = setup([], receipts);
  await first.emit("push", { data: { json: () => payload } });
  assert.equal(first.shown.length, 1);
  const restarted = setup([], receipts);
  await restarted.emit("push", { data: { json: () => payload } });
  assert.equal(
    restarted.shown.length,
    0,
    "durable receipt suppresses a duplicate",
  );
  await restarted.emit("push", {
    data: { json: () => ({ ...payload, notificationId: "after-restart" }) },
  });
  assert.equal(restarted.shown.length, 1, "new activity wakes a fresh worker");
  let closed = false;
  await restarted.emit("notificationclick", {
    notification: {
      close() {
        closed = true;
      },
      data: restarted.shown[0][1].data,
    },
  });
  assert.equal(closed, true);
  assert.equal(restarted.opened.length, 1);
  assert.deepEqual(
    JSON.parse(
      new URL(restarted.opened[0], "https://loom.test").searchParams.get(
        "push",
      ),
    ),
    payload.target,
  );
});

test("failed background display does not save a false delivery receipt", async () => {
  const receipts = new Map();
  const failing = setup([], receipts, async () => {
    throw Error("OS unavailable");
  });
  await failing.emit("push", { data: { json: () => payload } });
  assert.equal(failing.shown.length, 0);
  assert.equal(receipts.size, 0);
  const restarted = setup([], receipts);
  await restarted.emit("push", { data: { json: () => payload } });
  assert.equal(restarted.shown.length, 1);
});
