import assert from "node:assert/strict";
import test from "node:test";
test("document gate blocks new JSON requests, preserves sent requests and restores on persisted pageshow", async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    value: target,
    configurable: true,
  });
  let count = 0;
  let finish!: (value: Response) => void;
  globalThis.fetch = () => {
    count++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  try {
    const { pageFetch } =
      await import("../../frontends/raft/loom/page-fetch.ts");
    const sent = pageFetch("/write", {
      method: "POST",
      headers: {},
      body: "{}",
    });
    target.dispatchEvent(new Event("beforeunload"));
    await assert.rejects(pageFetch("/read", { method: "GET", headers: {} }), {
      name: "AbortError",
    });
    assert.equal(count, 1);
    finish(new Response("{}"));
    assert.equal((await sent).ok, true);
    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    target.dispatchEvent(restored);
    const next = pageFetch("/read", { method: "GET", headers: {} });
    assert.equal(count, 2);
    finish(new Response("{}"));
    await next;
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow)
      Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
