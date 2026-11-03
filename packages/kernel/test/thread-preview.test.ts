import test from "node:test";
import assert from "node:assert/strict";
import { roleInstanceFixture } from "./role-instance-fixture.ts";
import { ClientThreadsListRequestSchema } from "@rah-os/protocol";

test("opt-in thread preview returns latest three ordered bounded replies, without advancing read frontiers", () => {
  const f = roleInstanceFixture();
  try {
    const roomId = f.home.roomId;
    const root = f.kernel.postMessage(f.actor, {
      roomId,
      body: "root",
      recipients: [],
      idempotencyKey: "preview-root",
    });
    const { thread } = f.kernel.createThread(f.actor, {
      roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: f.head(roomId),
      idempotencyKey: "preview-thread",
    });
    for (let i = 0; i < 5; i++)
      f.kernel.replyThread(f.actor, {
        roomId,
        threadId: thread.threadId,
        body: `reply-${i} ` + "🟨".repeat(300),
        recipientIds: [],
        basedOnRoomSeq: f.head(roomId),
        idempotencyKey: `preview-${i}`,
      });
    const before = f.head(roomId);
    const plain = f.kernel.listThreads(f.actor, { roomId })[0]!;
    assert.equal((plain.viewerSummary as any)?.previews, undefined);
    const view = f.kernel.listThreads(f.actor, {
      roomId,
      previewRootMessageIds: [root.event.aggregateId],
    } as any)[0]!;
    const previews = (view.viewerSummary as any)?.previews;
    assert.equal(previews?.length, 3);
    assert.deepEqual(
      previews.map((r: any) => r.preview.slice(0, 7)),
      ["reply-2", "reply-3", "reply-4"],
    );
    assert.ok(
      previews.every(
        (r: any) =>
          r.preview.length <= 400 &&
          r.actorId === f.owner.principal.principalId,
      ),
    );
    assert.ok(
      previews[0].roomSeq < previews[1].roomSeq &&
        previews[1].roomSeq < previews[2].roomSeq,
    );
    assert.equal(f.head(roomId), before);
    assert.deepEqual(
      f.kernel.listThreads(f.actor, { roomId })[0]?.viewerSummary,
      plain.viewerSummary,
    );
    const other = f.channel("preview-other");
    assert.equal(
      f.kernel.listThreads(f.actor, {
        roomId: other.roomId,
        previewRootMessageIds: [root.event.aggregateId],
      } as any).length,
      0,
    );
    const outsider = f.kernel.provisionPrincipal({
      handle: "preview-outsider",
      kind: "human",
    });
    assert.throws(() =>
      f.kernel.listThreads(
        f.kernel.authenticateAccessToken(outsider.accessToken),
        { roomId, previewRootMessageIds: [root.event.aggregateId] } as any,
      ),
    );
  } finally {
    f.close();
  }
});
test("thread preview scope is bounded and rejects duplicate roots", () => {
  assert.equal(
    ClientThreadsListRequestSchema.safeParse({
      roomId: "r",
      previewRootMessageIds: Array(101).fill("m"),
    }).success,
    false,
  );
  assert.equal(
    ClientThreadsListRequestSchema.safeParse({
      roomId: "r",
      previewRootMessageIds: ["m", "m"],
    }).success,
    false,
  );
  assert.equal(
    ClientThreadsListRequestSchema.safeParse({
      roomId: "r",
      previewRootMessageIds: ["m"],
    }).success,
    true,
  );
});
