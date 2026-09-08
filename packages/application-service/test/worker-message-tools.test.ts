import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  WorkerMessageSearchResponseSchema,
  MessageSocialItemSchema,
} from "@rah-os/protocol";
import { RoomKernel } from "@rah-os/kernel";
import { WorkerApplicationService } from "../src/index.ts";

test("Run message search and reactions are scoped, bounded, causal and revocable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-worker-tools-"));
  const kernel = new RoomKernel({ databasePath: join(dir, "room.db") });
  const service = new WorkerApplicationService({ kernel });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
    const agent = kernel.provisionPrincipal({ handle: "agent", kind: "agent" });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, { name: "tools", slug: "tools" });
    kernel.addMember(actor, {
      roomId: room.roomId,
      principalId: agent.principal.principalId,
    });
    const hidden = kernel.createRoom(actor, { name: "hidden", slug: "hidden" });
    kernel.postMessage(actor, {
      roomId: hidden.roomId,
      body: "needle private",
      idempotencyKey: "hidden",
      recipients: [],
    });
    const first = kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "needle earlier",
      idempotencyKey: "first",
      recipients: [],
    });
    kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "needle wake",
      idempotencyKey: "wake",
      recipients: [
        { participantId: agent.principal.principalId, reason: "mention" },
      ],
    });
    const host = kernel.authenticateHostAccessToken(
      kernel.provisionHostCredential({
        hostId: "host",
        participantIds: [agent.principal.principalId],
      }).accessToken,
    );
    kernel.heartbeatHost(host);
    const activation = kernel.leaseNextActivation(host, { leaseMs: 30000 });
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
      consumerId: "tools",
      hostId: host.hostId,
      participantId: agent.principal.principalId,
      roomId: room.roomId,
      runAttemptId: run.runAttemptId,
      toSeq: activation.toSeq,
    });
    const request = (path: string, body: unknown) =>
      fetch(service.origin + "/v1/worker/" + path, {
        method: "POST",
        headers: {
          authorization: `Bearer ${credential.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    await request("sync", {});
    const future = kernel.postMessage(actor, {
      roomId: room.roomId,
      body: "needle future",
      idempotencyKey: "future",
      recipients: [],
    });
    const search = await request("messages/search", {
      query: "needle",
      limit: 1,
    });
    assert.equal(search.status, 200, await search.clone().text());
    const page = WorkerMessageSearchResponseSchema.parse(await search.json());
    assert.equal(page.messages.length, 1);
    assert.ok(page.nextCursor);
    assert.equal(page.frozenRoomCount, 1);
    const next = WorkerMessageSearchResponseSchema.parse(
      await (
        await request("messages/search", {
          query: "needle",
          limit: 1,
          cursor: page.nextCursor,
        })
      ).json(),
    );
    assert.deepEqual(
      [page.messages[0]!.body, next.messages[0]!.body],
      ["needle future", "needle wake"],
    );
    assert.equal(
      (
        await request("messages/search", {
          query: "needle",
          roomId: hidden.roomId,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("messages/search", {
          query: "other",
          cursor: page.nextCursor,
        })
      ).status,
      403,
    );
    const input = {
      messageId: first.event.aggregateId,
      emoji: "👍",
      active: true,
      basedOnRoomSeq: activation.toSeq,
      idempotencyKey: "reaction",
    };
    const reacted = await request("messages/react", input);
    assert.equal(reacted.status, 200, await reacted.clone().text());
    const result = MessageSocialItemSchema.parse(await reacted.json());
    assert.equal(result.reactions[0]!.count, 1);
    const replay = MessageSocialItemSchema.parse(
      await (await request("messages/react", input)).json(),
    );
    assert.equal(replay.version, result.version);
    assert.equal(
      (
        await request("messages/react", {
          ...input,
          messageId: future.event.aggregateId,
          idempotencyKey: "future-react",
        })
      ).status,
      403,
    );
    const visible = kernel.messageSocial.list(actor, {
      roomId: room.roomId,
      messageIds: [first.event.aggregateId],
    });
    assert.equal(
      visible.items[0]?.reactions[0]?.actors[0]?.principalId,
      agent.principal.principalId,
    );
    const removed = MessageSocialItemSchema.parse(
      await (
        await request("messages/react", {
          ...input,
          active: false,
          idempotencyKey: "remove",
        })
      ).json(),
    );
    assert.equal(removed.reactions.length, 0);
    credential.revoke();
    assert.equal(
      (await request("messages/search", { query: "needle" })).status,
      401,
    );
  } finally {
    await service.close();
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
