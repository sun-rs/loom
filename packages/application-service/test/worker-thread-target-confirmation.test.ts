import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";
import { renderWorkerReadResult } from "../../agent-host/src/worker-read-render.ts";

/**
 * Raft's `detectThreadContextParentSend`: an Agent that just read a Thread and
 * then sends to the parent Room top-level is asked to confirm exactly once.
 */
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rah-thread-target-"));
  const now = new Date("2026-09-09T10:00:00Z");
  const k = new RoomKernel({ databasePath: join(dir, "db"), now: () => now });
  k.initialize();
  const h = k.provisionPrincipal({ kind: "human", handle: "human" }),
    a = k.provisionPrincipal({ kind: "agent", handle: "agent" }),
    actor = k.authenticateAccessToken(h.accessToken);
  const origin = k.createRoom(actor, { name: "Origin", slug: "origin" }),
    target = k.createRoom(actor, { name: "Target", slug: "target" });
  for (const r of [origin, target])
    k.addMember(actor, {
      roomId: r.roomId,
      principalId: a.principal.principalId,
    });
  k.postMessage(actor, {
    roomId: origin.roomId,
    body: "Work",
    idempotencyKey: "wake",
    recipients: [{ participantId: a.principal.principalId, reason: "mention" }],
  });
  const host = k.authenticateHostAccessToken(
    k.provisionHostCredential({
      hostId: "fake-host",
      participantIds: [a.principal.principalId],
    }).accessToken,
  );
  k.heartbeatHost(host);
  const activation = k.leaseNextActivation(host, { leaseMs: 7200000 })!;
  const run = k.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "fake",
    recoveryDescriptor: { driver: "fake", recoveryKey: "fake", metadata: {} },
  };
  k.prepareRunAttemptRuntime(host, runtime);
  k.markRunAttemptRunning(host, runtime);
  const s = new WorkerApplicationService({ kernel: k, now: () => now });
  await s.start();
  const c = s.issueActivationCredential(
    host,
    {
      activationId: activation.activationId,
      consumerId: "worker",
      hostId: host.hostId,
      participantId: a.principal.principalId,
      roomId: origin.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    },
    { ttlMs: 7200000 },
  );
  const call = async (path: string, body: unknown = {}) => {
    const r = await fetch(`${s.origin}/v1/worker/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${c.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const thread = (label: string) => {
    const root = k.postMessage(actor, {
      roomId: target.roomId,
      body: `${label} root`,
      idempotencyKey: `${label}-root`,
      recipients: [],
    });
    return k.createThread(actor, {
      roomId: target.roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: root.event.roomSeq,
      idempotencyKey: `${label}-thread`,
    }).thread;
  };
  return {
    k,
    actor,
    call,
    thread,
    target,
    participantId: a.principal.principalId,
    topLevelBodies: () =>
      k
        .sync(actor, {
          roomId: target.roomId,
          consumerId: `audit-${Date.now()}`,
        })
        .events.filter(
          (event: any) =>
            event.type === "message.posted" &&
            event.payload.threadId === undefined,
        )
        .map((event: any) => event.payload.body),
    async close() {
      await s.close();
      k.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("A Thread read followed by a top-level send is refused once, then confirmed by the saved draft", async () => {
  const f = await fixture();
  try {
    const thread = f.thread("alpha");
    assert.equal(
      (await f.call("rooms/read", { channel: "#target" })).status,
      200,
    );
    assert.equal(
      (await f.call("rooms/read", { channel: `#target:${thread.threadId}` }))
        .status,
      200,
    );
    const refused = await f.call("messages/post", {
      channel: "#target",
      body: "Thread conclusion",
    });
    assert.equal(refused.status, 200, JSON.stringify(refused.body));
    assert.equal(refused.body.state, "target_confirmation_required");
    assert.equal(refused.body.reason, "thread_context_target_mismatch");
    assert.equal(refused.body.parentTarget, "#target");
    assert.equal(refused.body.threadTarget, `#target:${thread.threadId}`);
    assert.ok(refused.body.threadSeq > 0);
    assert.ok(typeof refused.body.heldDraftId === "string");
    assert.ok(
      !f.topLevelBodies().includes("Thread conclusion"),
      "the refused send must not publish anything",
    );
    // The confirmation affordance is Raft's own: --send-draft on that target.
    const sent = await f.call("messages/post", {
      channel: "#target",
      sendDraft: true,
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.event.payload.body, "Thread conclusion");
    assert.equal(sent.body.event.payload.threadId, undefined);
    assert.equal(
      sent.body.event.payload.heldDraftId,
      refused.body.heldDraftId,
      "the confirmation sends the exact saved draft",
    );
  } finally {
    await f.close();
  }
});

test("Reading the parent Room after the Thread clears the guard, and a Thread send is never guarded", async () => {
  const f = await fixture();
  try {
    const thread = f.thread("beta");
    assert.equal(
      (await f.call("rooms/read", { channel: `#target:${thread.threadId}` }))
        .status,
      200,
    );
    const inThread = await f.call("messages/post", {
      channel: `#target:${thread.threadId}`,
      body: "Reply inside the Thread",
    });
    assert.equal(inThread.status, 200, JSON.stringify(inThread.body));
    assert.equal(inThread.body.event.payload.threadId, thread.threadId);
    assert.equal(
      (await f.call("rooms/read", { channel: "#target" })).status,
      200,
    );
    const topLevel = await f.call("messages/post", {
      channel: "#target",
      body: "Deliberate top-level note",
    });
    assert.equal(topLevel.status, 200, JSON.stringify(topLevel.body));
    assert.equal(topLevel.body.event.payload.body, "Deliberate top-level note");
    assert.ok(f.topLevelBodies().includes("Deliberate top-level note"));
  } finally {
    await f.close();
  }
});

test("Two Threads in one Room: the refusal names the most recently read Thread", async () => {
  const f = await fixture();
  try {
    const first = f.thread("gamma"),
      second = f.thread("delta");
    for (const channel of [
      "#target",
      `#target:${first.threadId}`,
      `#target:${second.threadId}`,
    ])
      assert.equal((await f.call("rooms/read", { channel })).status, 200);
    const refused = await f.call("messages/post", {
      channel: "#target",
      body: "Which Thread was this?",
    });
    assert.equal(refused.status, 200, JSON.stringify(refused.body));
    assert.equal(refused.body.threadTarget, `#target:${second.threadId}`);
  } finally {
    await f.close();
  }
});

test("rendered message targets round-trip through the real Worker service without crossing Threads", async () => {
  const f = await fixture();
  try {
    for (const label of ["address-alpha", "address-beta"]) {
      const thread = f.thread(label);
      f.k.replyThread(f.actor, {
        basedOnRoomSeq: f.k.sync(f.actor, {
          roomId: f.target.roomId,
          consumerId: `setup-${label}`,
        }).latestRoomSeq,
        roomId: f.target.roomId,
        threadId: thread.threadId,
        body: `Read and reply to ${label}`,
        recipientIds: [],
        idempotencyKey: `${label}-instruction`,
      });
      const read = await f.call("rooms/read", {
        channel: `#target:${thread.threadId}`,
      });
      assert.equal(read.status, 200, JSON.stringify(read.body));
      const rendered = renderWorkerReadResult(
        "/v1/worker/rooms/read",
        {},
        read.body,
      )!;
      const line = rendered
        .split("\n")
        .find((line) => line.includes(`Read and reply to ${label}`))!;
      const channel = /target=([^ ]+)/u.exec(line)?.[1];
      const threadId = /threadId=([^ \]]+)/u.exec(line)?.[1];
      assert.equal(channel, "#target");
      assert.equal(threadId, thread.threadId);
      const reply = await f.call("messages/post", {
        channel,
        threadId,
        body: `${label} acknowledged`,
      });
      assert.equal(reply.status, 200, JSON.stringify(reply.body));
      assert.equal(
        reply.body.event?.type,
        "message.posted",
        JSON.stringify(reply.body),
      );
      assert.equal(reply.body.event.roomId, f.target.roomId);
      assert.equal(reply.body.event.payload.threadId, thread.threadId);
      assert.ok(!f.topLevelBodies().includes(`${label} acknowledged`));
    }
  } finally {
    await f.close();
  }
});

test("Worker delivery presents a resolvable channel and the sender's real handle", async () => {
  const f = await fixture();
  try {
    const response = await f.call("sync");
    assert.equal(response.status, 200);
    const output = renderWorkerReadResult(
      "/v1/worker/sync",
      {},
      response.body,
    )!;
    assert.match(output, /target=#origin .*@human: Work/);
    assert.doesNotMatch(output, /@principal_/);
    const resolved = await f.call("rooms/resolve", { channel: "#origin" });
    assert.equal(resolved.status, 200);
  } finally {
    await f.close();
  }
});

test("DM read surfaces name the peer handle and their displayed address sends to that DM", async () => {
  const f = await fixture();
  try {
    const workspace = f.k.createWorkspace(f.actor, {
      name: "Direct",
      slug: "direct",
      idempotencyKey: "workspace",
    });
    f.k.addMember(f.actor, {
      roomId: workspace.controlRoom.roomId,
      principalId: f.participantId,
    });
    const dm = f.k.openDirectRoom(f.actor, {
      workspaceId: workspace.workspace.workspaceId,
      peerPrincipalId: f.participantId,
      basedOnControlRoomSeq: f.k.sync(f.actor, {
        roomId: workspace.controlRoom.roomId,
        consumerId: "dm-head",
      }).latestRoomSeq,
      idempotencyKey: "dm",
    });
    const posted = f.k.postMessage(f.actor, {
      roomId: dm.roomId,
      body: "DM address check",
      recipients: [],
      idempotencyKey: "dm-message",
    });
    for (const [route, input] of [
      ["rooms/read", { channel: dm.roomId }],
      ["messages/history", { channel: dm.roomId }],
      ["messages/resolve", { messageId: posted.event.aggregateId }],
    ] as const) {
      const response = await f.call(route, input);
      assert.equal(response.status, 200, JSON.stringify(response.body));
      const rendered = renderWorkerReadResult(
        `/v1/worker/${route}`,
        input,
        response.body,
      )!;
      assert.match(rendered, /target=dm:@human .*@human: DM address check/);
      assert.doesNotMatch(rendered, /@principal_/);
    }
    const search = await f.call("messages/search", {
      query: "DM address check",
      channel: dm.roomId,
    });
    assert.equal(search.status, 200, JSON.stringify(search.body));
    const searchOutput = renderWorkerReadResult(
      "/v1/worker/messages/search",
      {},
      search.body,
    )!;
    assert.match(searchOutput, /Source: target=dm:@human/);
    assert.match(searchOutput, /Sender: @human/);
    assert.doesNotMatch(searchOutput, /@principal_/);
    const sent = await f.call("messages/post", {
      channel: "dm:@human",
      body: "Correct DM",
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.event.roomId, dm.roomId);
    for (const channel of [`dm-${dm.roomId}`, `dm:@${f.actor.principalId}`]) {
      assert.equal((await f.call("rooms/resolve", { channel })).status, 404);
    }
  } finally {
    await f.close();
  }
});
