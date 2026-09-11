import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "@rah-os/kernel";
import * as P from "@rah-os/protocol";
import { WorkerApplicationService } from "../src/index.ts";

test("cross-target posts require a complete signed latest-window receipt without altering origin execution authority", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-read-api-"));
  const now = new Date("2026-09-08T12:00:00.000Z");
  const kernel = new RoomKernel({
    databasePath: join(dir, "room.db"),
    now: () => now,
  });
  const service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
    const agent = kernel.provisionPrincipal({
      handle: "reader",
      kind: "agent",
    });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, {
      name: "Read API",
      slug: "read-api",
    });
    kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: agent.principal.principalId,
    });
    const task = kernel.createTask(actor, {
      roomId: room.roomId,
      title: "Earlier task",
      collaboratorIds: [],
      reviewerIds: [],
      dependencyTaskIds: [],
      idempotencyKey: "task",
    });
    kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "Read old tasks",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
      idempotencyKey: "wake",
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const activation = kernel.leaseNextActivation(host, { leaseMs: 60000 });
    assert.ok(activation);
    const run = kernel.createRunAttempt(host, {
      activationId: activation.activationId,
    });
    const runtime = {
      runAttemptId: run.runAttemptId,
      runtimeRunId: "runtime",
      recoveryDescriptor: {
        driver: "fake",
        metadata: {},
        recoveryKey: "runtime",
      },
    };
    kernel.prepareRunAttemptRuntime(host, runtime);
    kernel.markRunAttemptRunning(host, runtime);
    await service.start();
    const credential = service.issueActivationCredential(host, {
      activationId: activation.activationId,
      consumerId: "reader",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    const call = (path: string, body: unknown = {}) =>
      fetch(`${service.origin}/v1/worker/${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const other = kernel.createRoom(actor, { name: "Other", slug: "other" });
    kernel.addMember(actor, {
      roomId: other.roomId,
      principalId: agent.principal.principalId,
    });
    for (let n = 0; n < 80; n++)
      kernel.postMessage(actor, {
        roomId: other.roomId,
        body: `Historical ${n}`,
        recipients: [],
        idempotencyKey: `other-${n}`,
      });
    const result = await call("rooms/read", { channel: "#other", limit: 10 });
    assert.equal(result.status, 200, await result.clone().text());
    const context = P.WorkerRoomContextResponseSchema.parse(
      await result.json(),
    );
    assert.equal(context.window.events.length, 10);
    assert.ok(context.window.eventFloorSeq! > 0);
    assert.equal(context.window.snapshotSeq, context.throughRoomSeq);
    assert.equal(context.complete, true);
    const post = {
      channel: "#other",
      contextReceipt: context.contextReceipt,
      basedOnRoomSeq: context.throughRoomSeq,
      body: "Cross-room hello",
      idempotencyKey: "cross-post",
    };
    const before = await call("messages/post", {
      ...post,
      contextReceipt: context.contextReceipt.slice(0, -5) + "abcde",
    });
    assert.equal(before.status, 403, await before.clone().text());
    assert.equal(
      (await call("messages/post", { ...post, channel: room.roomId })).status,
      403,
    );
    const posted = await call("messages/post", post);
    assert.equal(posted.status, 200, await posted.clone().text());
    const mutation = P.WorkerMessagePostResponseSchema.parse(
      await posted.json(),
    );
    assert.ok("event" in mutation);
    assert.equal(mutation.event.roomId, other.roomId);
    assert.equal(mutation.event.actorId, agent.principal.principalId);
    const replay = P.WorkerMessagePostResponseSchema.parse(
      await (await call("messages/post", post)).json(),
    );
    assert.ok("event" in replay && replay.deduplicated);
    assert.equal(
      (await call("messages/post", { ...post, body: "changed" })).status,
      409,
    );
    const heldResponse = await call("messages/post", {
      ...post,
      idempotencyKey: "new-stale",
    });
    assert.equal(heldResponse.status, 200);
    const heldResult = P.WorkerMessagePostResponseSchema.parse(
      await heldResponse.json(),
    );
    assert.ok("state" in heldResult && heldResult.state === "held");
    assert.equal(heldResult.basedOnRoomSeq, post.basedOnRoomSeq);
    assert.equal(
      (await call("acknowledge", { throughSeq: activation.toSeq })).status,
      409,
    );
    const observer = new DatabaseSync(join(dir, "room.db"));
    try {
      assert.equal(
        observer
          .prepare("SELECT COUNT(*) AS n FROM subscription_cursors")
          .get()!.n,
        0,
      );
    } finally {
      observer.close();
    }
    const fresh = P.WorkerRoomContextResponseSchema.parse(
      await (await call("rooms/read", { channel: "#other", limit: 10 })).json(),
    );
    const newer = kernel.postMessage(actor, {
      roomId: other.roomId,
      body: "New fact",
      recipients: [],
      idempotencyKey: "later",
    });
    const laterResponse = await call("messages/post", {
      ...post,
      contextReceipt: fresh.contextReceipt,
      basedOnRoomSeq: fresh.throughRoomSeq,
      idempotencyKey: "later-post",
    });
    assert.equal(laterResponse.status, 200);
    const laterHeld = P.WorkerMessagePostResponseSchema.parse(
      await laterResponse.json(),
    );
    assert.ok("state" in laterHeld && laterHeld.state === "held");
    assert.ok(
      laterHeld.newerMessages.some(
        (event) => event.eventId === newer.event.eventId,
      ),
    );
    const current = P.WorkerRoomContextResponseSchema.parse(
      await (await call("rooms/read", { channel: "#other", limit: 10 })).json(),
    );
    assert.equal(current.throughRoomSeq, newer.event.roomSeq);
    const session = join(dir, "worker-session");
    writeFileSync(session, credential.accessToken, { mode: 0o600 });
    const module = new URL(
      "../../agent-host/src/worker-cli.ts",
      import.meta.url,
    ).href;
    const cli = async (args: string[]) => {
      const result = await promisify(execFile)(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `import {runWorkerCliCommand} from ${JSON.stringify(module)};process.exitCode=await runWorkerCliCommand(process.argv.slice(1));`,
          "worker",
          ...args,
        ],
        {
          cwd: fileURLToPath(new URL("../../..", import.meta.url)),
          env: {
            ...process.env,
            RAH_ACTIVATION_ID: activation.activationId,
            RAH_WORKER_API_URL: service.origin,
            RAH_WORKER_SESSION_FILE: session,
          },
          timeout: 15000,
          maxBuffer: P.ROOM_SYNC_RESPONSE_MAX_BYTES + 4096,
        },
      );
      return result.stdout;
    };
    const cliJson = async (args: string[]) => JSON.parse(await cli(args));
    /**
     * `room-read` renders Raft's window text. The receipt and the through-seq
     * stay on the line because RAH's `message-post --context-receipt` and
     * `--based-on-room-seq` take them; the rest is read off the same header.
     */
    const roomContext = (stdout: string) => {
      const header =
        /^Read window: (\d+) delivered at \S+(?: threadId=\S+)?, seq (\d+)-(\d+), (complete|truncated), oldest to newest\.$/mu.exec(
          stdout,
        );
      assert.ok(header, stdout);
      const receipt = /^Context receipt: (.+)$/mu.exec(stdout);
      assert.ok(receipt, stdout);
      return {
        complete: header[4] === "complete",
        contextReceipt: receipt[1]!,
        delivered: Number(header[1]),
        eventFloorSeq: Number(header[2]),
        hasSnapshot: /^Room snapshot at seq \d+: /mu.test(stdout),
        throughRoomSeq: Number(header[3]),
      };
    };
    const thread = kernel.createThread(actor, {
      roomId: other.roomId,
      rootMessageId: newer.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: newer.event.roomSeq,
      idempotencyKey: "target-thread",
    }).thread;
    const threadTarget = `#other:${thread.threadId}`;
    const threadContext = roomContext(
      await cli(["room-read", "--target", threadTarget]),
    );
    const threadPosted = P.WorkerMessagePostResponseSchema.parse(
      await cliJson([
        "message-post",
        "--json",
        "--target",
        threadTarget,
        "--context-receipt",
        threadContext.contextReceipt,
        "--based-on-room-seq",
        String(threadContext.throughRoomSeq),
        "--body",
        "Thread proof",
        "--idempotency-key",
        "thread-post",
      ]),
    );
    assert.ok("event" in threadPosted);
    assert.equal(threadPosted.event.payload.threadId, thread.threadId);
    const workspace = kernel.createWorkspace(actor, {
      name: "Direct",
      slug: "direct",
      idempotencyKey: "workspace",
    });
    kernel.addMember(actor, {
      roomId: workspace.controlRoom.roomId,
      principalId: agent.principal.principalId,
    });
    const dm = kernel.openDirectRoom(actor, {
      workspaceId: workspace.workspace.workspaceId,
      peerPrincipalId: agent.principal.principalId,
      basedOnControlRoomSeq: kernel.sync(actor, {
        roomId: workspace.controlRoom.roomId,
        consumerId: "dm-head",
      }).latestRoomSeq,
      idempotencyKey: "dm",
    });
    const dmContext = roomContext(
      await cli(["room-read", "--target", "dm:@human"]),
    );
    const dmPosted = P.WorkerMessagePostResponseSchema.parse(
      await cliJson([
        "message-post",
        "--json",
        "--target",
        "dm:@human",
        "--context-receipt",
        dmContext.contextReceipt,
        "--based-on-room-seq",
        String(dmContext.throughRoomSeq),
        "--body",
        "Direct proof",
        "--idempotency-key",
        "dm-post",
      ]),
    );
    assert.ok("event" in dmPosted);
    assert.equal(dmPosted.event.roomId, dm.roomId);
    for (let n = 0; n < 20; n++)
      kernel.postMessage(actor, {
        roomId: other.roomId,
        body: `${n}${"汉".repeat(40000)}`,
        recipients: [],
        idempotencyKey: `large-${n}`,
      });
    const partialText = await cli([
      "room-read",
      "--target",
      "#other",
      "--limit",
      "20",
    ]);
    const partial = roomContext(partialText);
    assert.equal(partial.complete, false);
    // The bound applies to the bytes the Agent actually reads.
    assert.ok(Buffer.byteLength(partialText) <= P.ROOM_SYNC_RESPONSE_MAX_BYTES);
    assert.equal(
      (
        await call("messages/post", {
          ...post,
          contextReceipt: partial.contextReceipt,
          basedOnRoomSeq: partial.throughRoomSeq,
          idempotencyKey: "partial-post",
        })
      ).status,
      403,
    );
    const remainder = roomContext(
      await cli([
        "room-read",
        "--target",
        "#other",
        "--limit",
        "20",
        "--context-receipt",
        partial.contextReceipt,
      ]),
    );
    assert.equal(remainder.complete, true);
    assert.equal(partial.delivered + remainder.delivered, 20);
    assert.equal(remainder.hasSnapshot, false);
    assert.equal(remainder.eventFloorSeq, partial.eventFloorSeq);
    const completedPost = P.WorkerMessagePostResponseSchema.parse(
      await cliJson([
        "message-post",
        "--json",
        "--target",
        "#other",
        "--context-receipt",
        remainder.contextReceipt,
        "--based-on-room-seq",
        String(remainder.throughRoomSeq),
        "--body",
        "After complete tail",
        "--idempotency-key",
        "tail-post",
      ]),
    );
    assert.ok("event" in completedPost);
    const revokedTarget = P.WorkerRoomContextResponseSchema.parse(
      await (await call("rooms/read", { channel: "#other", limit: 1 })).json(),
    );
    const db = new DatabaseSync(join(dir, "room.db"));
    try {
      db.prepare(
        "DELETE FROM memberships WHERE room_id=? AND principal_id=?",
      ).run(other.roomId, agent.principal.principalId);
    } finally {
      db.close();
    }
    assert.equal(
      (
        await call("messages/post", {
          ...post,
          contextReceipt: revokedTarget.contextReceipt,
          basedOnRoomSeq: revokedTarget.throughRoomSeq,
          idempotencyKey: "not-member",
        })
      ).status,
      404,
    );
    credential.revoke();
    assert.equal(
      (
        await call("messages/post", {
          ...post,
          contextReceipt: current.contextReceipt,
          basedOnRoomSeq: current.throughRoomSeq,
          idempotencyKey: "revoked",
        })
      ).status,
      401,
    );
  } finally {
    await service.close();
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
