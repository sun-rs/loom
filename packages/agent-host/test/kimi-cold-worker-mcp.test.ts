import assert from "node:assert/strict";
import test from "node:test";
import { KimiColdWorkerMcp } from "../src/kimi-cold-worker-mcp.ts";

test("cold Kimi transport identity binds original execution and unknown result fences future calls", async () => {
  let sends = 0;
  const cold = new KimiColdWorkerMcp(
    "http://127.0.0.1:1",
    async () => {
      sends++;
      throw Error("unknown");
    },
    { runAttemptId: "original", accessToken: "secret", isActive: () => true },
    "11111111-1111-4111-8111-111111111111",
  );
  const params = {
    name: "loom_reply",
    arguments: { body: "done", final: true },
  };
  assert.equal((await cold.call(params)).isError, true);
  assert.equal(
    (await cold.call({ ...params, _meta: { callId: "model-forged" } })).isError,
    true,
  );
  assert.equal(sends, 0);
  const identity = {
    nonce: "11111111-1111-4111-8111-111111111111",
    requestId: 2,
  };
  for (const requestId of [2, 2, 3])
    assert.equal(
      (
        await cold.call({
          ...params,
          transportIdentity: { ...identity, requestId },
        })
      ).isError,
      true,
    );
  assert.equal(sends, 1);
  cold.close();
});

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

test("cold socket revoked before a later Run cannot borrow its authority", async () => {
  const { createKimiColdWorkerMcpBridge } =
    await import("../src/worker-mcp-bridge.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { request } = await import("node:http");
  const dir = await mkdtemp(join(tmpdir(), "claude-mcp-test-"));
  const credentials: string[] = [];
  const make = (id: string) =>
    createKimiColdWorkerMcpBridge({
      socketPath: join(dir, id + ".sock"),
      workerApiOrigin: "http://127.0.0.1:1",
      binding: { runAttemptId: id, accessToken: id, isActive: () => true },
      transportNonce: "11111111-1111-4111-8111-111111111111",
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
      q.end(
        JSON.stringify({
          name: "loom_reply",
          arguments: { body: "done", final: true },
          transportIdentity: {
            nonce: "11111111-1111-4111-8111-111111111111",
            requestId: 2,
          },
        }),
      );
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

test("entry reconnection replays original id receipt, changed parameters fail rather than create another write", async () => {
  let sends = 0;
  const nonce = "11111111-1111-4111-8111-111111111111";
  const cold = new KimiColdWorkerMcp(
    "http://127.0.0.1:1",
    async () => {
      sends++;
      return Response.json(posted);
    },
    { runAttemptId: "original", accessToken: "secret", isActive: () => true },
    nonce,
  );
  const params = {
    name: "loom_reply",
    arguments: { body: "first", final: true },
    transportIdentity: { nonce, requestId: 2 },
  };
  const first = await cold.call(params);
  assert.equal(first.isError, false);
  assert.deepEqual(await cold.call(structuredClone(params)), first);
  assert.equal(
    (
      await cold.call({
        ...params,
        arguments: { body: "new meaning", final: true },
      })
    ).isError,
    true,
  );
  assert.equal(
    (
      await cold.call({
        ...params,
        transportIdentity: {
          nonce: "22222222-2222-4222-8222-222222222222",
          requestId: 2,
        },
      })
    ).isError,
    true,
  );
  assert.equal(sends, 1);
  cold.close();
});
