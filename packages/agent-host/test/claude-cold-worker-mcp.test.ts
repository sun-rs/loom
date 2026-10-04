import assert from "node:assert/strict";
import test from "node:test";
import { ClaudeColdWorkerMcp } from "../src/claude-cold-worker-mcp.ts";
const posted = {
  activationIds: [],
  deduplicated: false,
  event: {
    eventId: "event",
    roomId: "room",
    roomSeq: 2,
    type: "message.posted",
    actorId: "instance",
    aggregateType: "message",
    aggregateId: "message",
    payload: { body: "do not echo" },
    idempotencyKey: "key",
    schemaVersion: 1,
    createdAt: "2026-10-04T00:00:00.000Z",
  },
};
const params = (call = "tool-1", body = "done") => ({
  name: "loom_reply",
  arguments: { body, final: true },
  _meta: { "claudecode/toolUseId": call, progressToken: 1 },
});
test("Claude cold binds original Run, deduplicates native toolUseId and returns compact verified receipt", async () => {
  const sends: RequestInit[] = [];
  const cold = new ClaudeColdWorkerMcp(
    "http://127.0.0.1:1",
    async (_url, init) => {
      sends.push(init!);
      return Response.json(posted);
    },
    {
      runAttemptId: "original",
      accessToken: "original-secret",
      isActive: () => true,
    },
  );
  const [a, b] = await Promise.all([cold.call(params()), cold.call(params())]);
  assert.deepEqual(a, b);
  assert.equal(a.isError, false);
  assert.equal(sends.length, 1);
  assert.equal(
    (sends[0]!.headers as Record<string, string>).authorization,
    "Bearer original-secret",
  );
  const receipt = JSON.parse(a.content[0]!.text);
  assert.equal(receipt.eventId, "event");
  assert.equal(receipt.actorId, "instance");
  assert.ok(!a.content[0]!.text.includes("do not echo"));
  assert.equal((await cold.call(params("tool-1", "changed"))).isError, true);
  assert.equal(sends.length, 1);
  cold.close();
  assert.equal((await cold.call(params("tool-2"))).isError, true);
  assert.equal(sends.length, 1);
});
test("Claude cold requires native toolUseId, forbids model identity and fences unknown writes", async () => {
  let sends = 0;
  const cold = new ClaudeColdWorkerMcp(
    "http://127.0.0.1:1",
    async () => {
      sends++;
      throw Error("lost after write");
    },
    { runAttemptId: "run", accessToken: "secret", isActive: () => true },
  );
  assert.equal(
    (await cold.call({ ...params(), _meta: { callId: "codex-only" } })).isError,
    true,
  );
  assert.equal(
    (
      await cold.call({
        ...params(),
        arguments: { ...params().arguments, actorId: "forged" },
      })
    ).isError,
    true,
  );
  assert.equal(sends, 0);
  for (const call of ["a", "a", "b"])
    assert.equal((await cold.call(params(call))).isError, true);
  assert.equal(sends, 1);
  cold.close();
});
test("cold socket revoked before a later Run cannot borrow its authority", async () => {
  const { createClaudeColdWorkerMcpBridge } =
    await import("../src/worker-mcp-bridge.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { request } = await import("node:http");
  const dir = await mkdtemp(join(tmpdir(), "claude-mcp-test-"));
  const credentials: string[] = [];
  const make = (id: string) =>
    createClaudeColdWorkerMcpBridge({
      socketPath: join(dir, id + ".sock"),
      workerApiOrigin: "http://127.0.0.1:1",
      binding: { runAttemptId: id, accessToken: id, isActive: () => true },
      fetch: async (_u, i) => {
        credentials.push((i!.headers as Record<string, string>).authorization!);
        return Response.json(posted);
      },
    });
  const invoke = (
    b: Awaited<ReturnType<typeof make>>,
    secret = b.env.LOOM_WORKER_MCP_SECRET,
  ) =>
    new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      const q = request(
        {
          socketPath: b.env.LOOM_WORKER_MCP_SOCKET,
          path: "/call",
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
        },
        (r) => {
          let s = "";
          r.on("data", (c) => (s += c));
          r.on("end", () =>
            resolve({ status: r.statusCode!, body: JSON.parse(s) }),
          );
        },
      );
      q.on("error", reject);
      q.end(JSON.stringify(params()));
    });
  const old = await make("old");
  let next: Awaited<ReturnType<typeof make>> | undefined;
  try {
    assert.equal((await invoke(old)).status, 200);
    await old.close();
    next = await make("next");
    await assert.rejects(invoke(old));
    assert.equal(
      (await invoke(next, old.env.LOOM_WORKER_MCP_SECRET)).status,
      401,
    );
    assert.equal((await invoke(next)).status, 200);
    assert.deepEqual(credentials, ["Bearer old", "Bearer next"]);
  } finally {
    await old.close();
    await next?.close();
    await rm(dir, { recursive: true, force: true });
  }
});
