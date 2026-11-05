import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import {
  createFixture,
  isolatedEnvironment,
  assertStudySocket,
} from "./fixture.mjs";

test("scratch environment drops credentials, proxies and inherited Herdr target", () => {
  const root = mkdtempSync("/tmp/lh-test-");
  try {
    const env = isolatedEnvironment(root, {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "secret",
      HTTPS_PROXY: "http://proxy",
      HERDR_SOCKET_PATH: "/user/active.sock",
    });
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.HTTPS_PROXY, undefined);
    assert.equal(env.HERDR_SOCKET_PATH, undefined);
    assert.equal(env.HOME, root + "/home");
    assert.equal(env.PI_OFFLINE, "1");
    assert.throws(() => assertStudySocket(root, "/user/active.sock"));
    assertStudySocket(root, root + "/config/herdr/sessions/probe/herdr.sock");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("localhost fixture requires an actual tool receipt, streams one final, refuses other routes", async () => {
  const fixture = await createFixture();
  try {
    const post = async (messages) =>
      await fetch(fixture.origin + "/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "fixture", messages, stream: true }),
      });
    const first = await (
      await post([{ role: "user", content: "Read the fixture." }])
    ).text();
    assert.match(first, /tool_calls/);
    const bad = await post([
      { role: "user", content: "Read the fixture." },
      { role: "tool", tool_call_id: "read-1", content: "invented" },
    ]);
    assert.equal(bad.status, 400);
    const second = await (
      await post([
        { role: "user", content: "Read the fixture." },
        { role: "tool", tool_call_id: "read-1", content: fixture.marker },
      ])
    ).text();
    const text = second
      .split("\n")
      .filter((x) => x.startsWith("data: {"))
      .map((x) => JSON.parse(x.slice(6)).choices[0]?.delta?.content ?? "")
      .join("");
    assert.equal(text, "Fixture task completed.");
    assert.equal(fixture.receipts.length, 1);
    assert.equal((await fetch(fixture.origin + "/wrong")).status, 404);
    assert.equal(fixture.paidCalls, 0);
  } finally {
    await fixture.close();
  }
});
