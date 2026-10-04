import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import test from "node:test";
import { createWorkerMcpBridge } from "../src/worker-mcp-bridge.ts";
import { WorkerMcpTurns } from "../src/worker-mcp-turns.ts";

const posted = {
  activationIds: [],
  deduplicated: false,
  event: {
    eventId: "event",
    roomId: "room",
    roomSeq: 1,
    type: "message.posted",
    actorId: "instance",
    aggregateType: "message",
    aggregateId: "message",
    payload: {},
    idempotencyKey: "key",
    schemaVersion: 1,
    createdAt: "2026-10-04T00:00:00.000Z",
  },
};
const held = {
  activationIds: [],
  basedOnRoomSeq: 1,
  heldDraftId: "draft",
  readReceiptId: "00000000-0000-4000-8000-000000000000",
  newMessageCount: 1,
  newerMessages: [{ ...posted.event, payload: { body: "new fact" } }],
  omittedMessageCount: 0,
  reason: "newer_messages_available",
  reholdCount: 1,
  shownMessageCount: 1,
  continueAnywaySuggested: false,
  seenUpToSeq: 2,
  state: "held",
};

function params(turn = "turn-1", call = "call-1", body = "done") {
  return {
    name: "loom_reply",
    arguments: { body, final: true },
    _meta: {
      threadId: "thread",
      sessionId: "thread",
      callId: call,
      "x-codex-turn-metadata": {
        thread_id: "thread",
        session_id: "thread",
        turn_id: turn,
      },
    },
  };
}
async function fixture(
  fetcher: typeof fetch = async () => Response.json(posted),
) {
  const directory = await mkdtemp(join(tmpdir(), "loom-mcp-"));
  const bridge = await createWorkerMcpBridge({
    socketPath: join(directory, "mcp.sock"),
    workerApiOrigin: "http://127.0.0.1:1234",
    fetch: fetcher,
  });
  let active = true;
  const unbind = bridge.bind({
    runAttemptId: "run-1",
    threadId: "thread",
    admission: Promise.resolve({ kind: "accepted", nativeTurnId: "turn-1" }),
    accessToken: "worker-secret",
    isActive: () => active,
  });
  const call = (body: unknown, secret = bridge.env.LOOM_WORKER_MCP_SECRET) =>
    new Promise<any>((resolve, reject) => {
      const req = request(
        {
          socketPath: bridge.env.LOOM_WORKER_MCP_SOCKET,
          path: "/call",
          method: "POST",
          headers: {
            authorization: `Bearer ${secret}`,
            "content-type": "application/json",
          },
        },
        (res) => {
          let text = "";
          res.on("data", (x) => (text += x));
          res.on("end", () =>
            resolve({ status: res.statusCode, body: JSON.parse(text) }),
          );
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  return {
    bridge,
    call,
    unbind,
    stop: () => {
      active = false;
    },
    close: async () => {
      await bridge.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("MCP authenticates exact original turn and deduplicates concurrent same-call writes", async () => {
  const sends: any[] = [];
  const f = await fixture(async (url, init) => {
    sends.push({ url, init });
    return Response.json(posted);
  });
  try {
    const [a, b] = await Promise.all([f.call(params()), f.call(params())]);
    assert.equal(a.body.isError, false);
    assert.deepEqual(a, b);
    assert.equal(sends.length, 1);
    assert.equal(sends[0].url, "http://127.0.0.1:1234/v1/worker/messages/post");
    assert.equal(sends[0].init.headers.authorization, "Bearer worker-secret");
    assert.ok(JSON.parse(sends[0].init.body).idempotencyKey);
    assert.equal(
      (await f.call(params("turn-1", "call-1", "changed"))).body.isError,
      true,
    );
    assert.equal(sends.length, 1);
  } finally {
    await f.close();
  }
});

test("missing/conflicting identities, model identity injection and revoked old turns never write", async () => {
  let writes = 0;
  const f = await fixture(async () => {
    writes++;
    return Response.json(posted);
  });
  try {
    assert.equal((await f.call(params(), "wrong")).status, 401);
    for (const p of [
      { ...params(), _meta: {} },
      { ...params(), _meta: { ...params()._meta, threadId: "foreign" } },
      params("old"),
      { ...params(), arguments: { ...params().arguments, actorId: "foreign" } },
    ])
      assert.equal((await f.call(p)).body.isError, true);
    f.stop();
    assert.equal((await f.call(params())).body.isError, true);
    f.unbind();
    f.bridge.bind({
      runAttemptId: "run-2",
      threadId: "thread",
      admission: Promise.resolve({ kind: "accepted", nativeTurnId: "turn-2" }),
      accessToken: "new-secret",
      isActive: () => true,
    });
    assert.equal((await f.call(params())).body.isError, true);
    assert.equal(writes, 0);
  } finally {
    await f.close();
  }
});

test("unknown write result is retained and cannot be silently resent with another call ID", async () => {
  let writes = 0;
  const f = await fixture(async () => {
    writes++;
    throw Error("network lost");
  });
  try {
    for (const call of ["call-1", "call-1", "call-2"])
      assert.equal((await f.call(params("turn-1", call))).body.isError, true);
    assert.equal(writes, 1);
  } finally {
    await f.close();
  }
});

test("held reply returns recovery guidance without synthesizing a read receipt or ACK", async () => {
  let writes = 0;
  const f = await fixture(async () => {
    writes++;
    return Response.json(held);
  });
  try {
    const r = await f.call(params());
    assert.equal(r.body.isError, true);
    const text = r.body.content[0].text;
    assert.ok(text.includes("new fact"));
    assert.ok(text.includes("Worker CLI"));
    assert.ok(!text.includes(held.readReceiptId));
    assert.equal(writes, 1);
  } finally {
    await f.close();
  }
});

test("malformed successful response and server failure keep the write outcome unknown", async () => {
  for (const response of [
    Response.json({}),
    Response.json({ error: "internal" }, { status: 500 }),
  ]) {
    let sends = 0;
    const f = await fixture(async () => {
      sends++;
      return response;
    });
    try {
      assert.equal((await f.call(params())).body.isError, true);
      assert.equal(
        (await f.call(params("turn-1", "new-call"))).body.isError,
        true,
      );
      assert.equal(sends, 1);
    } finally {
      await f.close();
    }
  }
});

test("early native calls wait for their original admission and cannot adopt a later registration", async () => {
  let sends = 0;
  const turns = new WorkerMcpTurns("http://127.0.0.1:1", async () => {
    sends++;
    return Response.json(posted);
  });
  let accept!: (v: { kind: "accepted"; nativeTurnId: string }) => void;
  const admission = new Promise<{ kind: "accepted"; nativeTurnId: string }>(
    (resolve) => {
      accept = resolve;
    },
  );
  const unbind = turns.bind({
    runAttemptId: "run-old",
    threadId: "thread",
    admission,
    accessToken: "old",
    isActive: () => true,
  });
  const early = turns.call(params("turn-new"));
  assert.equal(sends, 0);
  unbind();
  turns.bind({
    runAttemptId: "run-new",
    threadId: "thread",
    admission: Promise.resolve({ kind: "accepted", nativeTurnId: "turn-new" }),
    accessToken: "new",
    isActive: () => true,
  });
  accept({ kind: "accepted", nativeTurnId: "turn-old" });
  assert.equal((await early).isError, true);
  assert.equal(sends, 0);
  assert.equal((await turns.call(params("turn-new"))).isError, false);
  assert.equal(sends, 1);
  turns.close();
});
