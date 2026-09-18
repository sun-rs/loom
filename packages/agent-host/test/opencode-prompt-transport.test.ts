import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { fetchOpenCodePrompt } from "../src/opencode-prompt-transport.mjs";

test("OpenCode prompt can wait beyond five minutes for response headers", async (t) => {
  const releases: (() => void)[] = [];
  let received!: () => void;
  const arrived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const server = createServer((req, res) => {
    req.resume();
    releases.push(() =>
      res.end(JSON.stringify({ info: { role: "assistant" }, parts: [] })),
    );
    if (releases.length === 2) received();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const nativeSetTimeout = globalThis.setTimeout;
  let ticks = 0;
  // Accelerate Undici's coarse timer wheel; a mocked Timeout.refresh does not
  // reliably advance that wheel on all supported Node releases.
  t.mock.method(
    globalThis,
    "setTimeout",
    (callback: (...args: any[]) => void, delay?: number, ...args: any[]) =>
      callback.name === "onTick" && delay === 499
        ? nativeSetTimeout(() => {
            ticks++;
            callback(...args);
          }, 1)
        : nativeSetTimeout(callback, delay, ...args),
  );
  try {
    const url = new URL(
      `http://127.0.0.1:${address.port}/session/fake/message`,
    );
    let controlSettled = false;
    const control = fetch(url, { method: "POST", body: "{}" })
      .catch((error) => error)
      .finally(() => {
        controlSettled = true;
      });
    const result = fetchOpenCodePrompt(url, { method: "POST", body: "{}" })
      .then((response) => response.json())
      .catch((error) => error);
    await arrived;
    const deadline = Date.now() + 10_000;
    while (!controlSettled && Date.now() < deadline)
      await new Promise((resolve) => nativeSetTimeout(resolve, 10));
    assert.ok(
      ticks >= 602 && controlSettled,
      "the actual Undici clock must advance beyond 300 seconds",
    );
    for (const release of releases) release();
    const controlFailure = await control;
    assert.ok(controlFailure instanceof Error);
    assert.match(String(controlFailure.cause), /Headers Timeout/);
    const outcome = await result;
    assert.ok(
      !(outcome instanceof Error),
      String(outcome instanceof Error ? outcome.cause : outcome),
    );
    assert.deepEqual(outcome, { info: { role: "assistant" }, parts: [] });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("OpenCode prompt preserves status/body, honors cancellation, and reports broken connections", async () => {
  let received!: () => void;
  const arrived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const server = createServer((req, res) => {
    req.resume();
    if (req.url === "/cancel") {
      received();
      return;
    }
    if (req.url === "/disconnect") {
      req.socket.destroy();
      return;
    }
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "provider unavailable" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = (path: string) =>
    new URL(`http://127.0.0.1:${address.port}${path}`);
  try {
    const response = await fetchOpenCodePrompt(url("/failure"), {
      method: "POST",
      body: "{}",
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "provider unavailable" });
    const controller = new AbortController();
    const cancelled = fetchOpenCodePrompt(url("/cancel"), {
      signal: controller.signal,
    });
    const rejected = assert.rejects(cancelled, /ABORT_ERR/);
    await arrived;
    controller.abort();
    await rejected;
    await assert.rejects(
      fetchOpenCodePrompt(url("/disconnect"), {}),
      /ECONNRESET/,
    );
    await assert.rejects(
      fetchOpenCodePrompt(new URL("https://example.com/message"), {}),
      /local server/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
