import assert from "node:assert/strict";
import { test } from "node:test";
import { forkOpenCodeSession } from "../src/opencode-session-fork.ts";

test("OpenCode fork performs only copy/status operations and rejects the source ID", async () => {
  const calls: string[] = [];
  const request = async (path: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/session/status") return {};
    return { id: "child" };
  };
  assert.equal(await forkOpenCodeSession(request, "source"), "child");
  assert.deepEqual(calls, ["GET /session/status", "POST /session/source/fork"]);
  await assert.rejects(
    () =>
      forkOpenCodeSession(
        async (path) => (path === "/session/status" ? {} : { id: "source" }),
        "source",
      ),
    /independent/,
  );
});
test("OpenCode native busy status refuses copying without a POST", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      forkOpenCodeSession(async () => {
        calls++;
        return { source: { type: "busy" } };
      }, "source"),
    /idle/,
  );
  assert.equal(calls, 1);
});
