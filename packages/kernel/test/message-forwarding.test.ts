import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";
import { forwardedAttachmentProjectionId } from "../src/room-files.ts";

async function* bytes(value: string) {
  yield Buffer.from(value);
}

async function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString();
}

test("canonical forwarding snapshots source messages in Room order without Agent attention", () => {
  const fixture = forwardingFixture();
  try {
    const root = fixture.kernel.postMessage(fixture.ownerActor, {
      body: "root source",
      idempotencyKey: "source-root",
      recipients: [],
      roomId: fixture.source.roomId,
    });
    const thread = fixture.kernel.createThread(fixture.ownerActor, {
      basedOnRoomSeq: root.event.roomSeq,
      idempotencyKey: "source-thread",
      recipientIds: [],
      roomId: fixture.source.roomId,
      rootMessageId: root.event.aggregateId,
    });
    const reply = fixture.kernel.replyThread(fixture.ownerActor, {
      basedOnRoomSeq: thread.event.roomSeq,
      body: "thread source",
      idempotencyKey: "source-reply",
      recipientIds: [],
      roomId: fixture.source.roomId,
      threadId: thread.thread.threadId,
    });

    const targets = fixture.kernel.listMessageForwardTargets(
      fixture.ownerActor,
      {
        limit: 20,
        query: "target",
        sourceRoomId: fixture.source.roomId,
      },
    );
    assert.deepEqual(
      targets.map(({ roomId }) => roomId),
      [fixture.target.roomId],
    );

    const result = fixture.kernel.forwardMessages(fixture.ownerActor, {
      destinationRoomIds: [fixture.target.roomId],
      note: "review these",
      requestId: "forward-one",
      sourceMessageIds: [reply.event.aggregateId, root.event.aggregateId],
      sourceRoomId: fixture.source.roomId,
    });
    const delivered = result.results[0];
    assert.equal(delivered?.status, "delivered");
    if (delivered?.status !== "delivered") {
      throw new Error("expected forwarding delivery");
    }
    assert.deepEqual(result.results, [
      {
        deduplicated: false,
        destinationRoomId: fixture.target.roomId,
        messageId: delivered.messageId,
        status: "delivered",
      },
    ]);
    const forwarded = fixture.kernel
      .listMessages(fixture.ownerActor, {
        roomId: fixture.target.roomId,
      })
      .messages.at(-1);
    assert.equal(forwarded?.body, "review these");
    assert.deepEqual(
      forwarded?.forwardedBundle?.items.map((item) => ({
        body: item.body,
        child: item.isThreadChild,
        root: item.sourceRootMessageId,
        thread: item.sourceThreadId,
      })),
      [
        {
          body: "root source",
          child: false,
          root: undefined,
          thread: undefined,
        },
        {
          body: "thread source",
          child: true,
          root: root.event.aggregateId,
          thread: thread.thread.threadId,
        },
      ],
    );
    assert.deepEqual(
      fixture.kernel.listInbox(fixture.agentActor, {
        roomId: fixture.target.roomId,
      }),
      [],
      "forwarding without an explicit mention must not create Agent attention",
    );

    const replay = fixture.kernel.forwardMessages(fixture.ownerActor, {
      destinationRoomIds: [fixture.target.roomId],
      note: "review these",
      requestId: "forward-one",
      sourceMessageIds: [reply.event.aggregateId, root.event.aggregateId],
      sourceRoomId: fixture.source.roomId,
    });
    assert.equal(replay.results[0]?.status, "delivered");
    assert.equal(
      replay.results[0]?.status === "delivered" &&
        replay.results[0].deduplicated,
      true,
    );
    assert.equal(
      fixture.kernel.listMessages(fixture.ownerActor, {
        roomId: fixture.target.roomId,
      }).messages.length,
      1,
    );
  } finally {
    fixture.close();
  }
});

test("forwarded attachments receive destination-scoped identities without duplicating blob bytes", async () => {
  const fixture = forwardingFixture();
  try {
    const secondTarget = fixture.kernel.createRoom(fixture.ownerActor, {
      name: "Second Target",
      slug: "second-target",
    });
    const upload = fixture.kernel.files.prepare(fixture.ownerActor, {
      filename: "evidence.txt",
      idempotencyKey: "forward-attachment-upload",
      mimeType: "text/plain",
      roomId: fixture.source.roomId,
      size: 15,
    });
    await fixture.kernel.files.upload(
      fixture.ownerActor,
      upload.attachmentId,
      bytes("forwarded bytes"),
    );
    const source = fixture.kernel.postRoomMessage(fixture.ownerActor, {
      attachmentIds: [upload.attachmentId],
      basedOnRoomSeq: fixture.kernel.sync(fixture.ownerActor, {
        consumerId: "forward-attachment-source-head",
        roomId: fixture.source.roomId,
      }).latestRoomSeq,
      body: "attached source",
      idempotencyKey: "forward-attachment-source",
      roomId: fixture.source.roomId,
    });

    const request = {
      destinationRoomIds: [fixture.target.roomId, secondTarget.roomId],
      requestId: "forward-with-attachment",
      sourceMessageIds: [source.event.aggregateId],
      sourceRoomId: fixture.source.roomId,
    };
    const result = fixture.kernel.forwardMessages(fixture.ownerActor, request);
    assert.deepEqual(
      result.results.map((entry) => entry.status),
      ["delivered", "delivered"],
    );

    const projectedIds = [fixture.target.roomId, secondTarget.roomId].map(
      (roomId) => {
        const message = fixture.kernel.listMessages(fixture.ownerActor, {
          roomId,
        }).messages[0];
        const projected = message?.forwardedBundle?.items[0]?.attachments[0];
        assert.ok(projected);
        assert.notEqual(projected.attachmentId, upload.attachmentId);
        assert.equal(projected.filename, "evidence.txt");
        assert.equal(
          fixture.kernel.files.list(fixture.ownerActor, { roomId }).files[0]
            ?.attachmentId,
          projected.attachmentId,
        );
        return projected.attachmentId;
      },
    );
    assert.notEqual(projectedIds[0], projectedIds[1]);
    const sourceStat = statSync(
      join(fixture.directory, "room-files", upload.attachmentId),
    );
    for (const projectedId of projectedIds) {
      const projectedStat = statSync(
        join(fixture.directory, "room-files", projectedId),
      );
      assert.equal(projectedStat.dev, sourceStat.dev);
      assert.equal(projectedStat.ino, sourceStat.ino);
    }
    const targetDownload = await fixture.kernel.files.download(
      fixture.agentActor,
      projectedIds[0]!,
    );
    assert.equal(await streamText(targetDownload.stream), "forwarded bytes");
    await assert.rejects(
      fixture.kernel.files.download(fixture.agentActor, upload.attachmentId),
      /member|access|forbidden/i,
    );

    const replay = fixture.kernel.forwardMessages(fixture.ownerActor, request);
    assert.deepEqual(
      replay.results.map((entry) =>
        entry.status === "delivered" ? entry.deduplicated : false,
      ),
      [true, true],
    );
    assert.deepEqual(
      [fixture.target.roomId, secondTarget.roomId].map(
        (roomId) =>
          fixture.kernel.listMessages(fixture.ownerActor, { roomId }).messages
            .length,
      ),
      [1, 1],
    );
  } finally {
    fixture.close();
  }
});

test("source and destination Room deletion reclaim only their own forwarded attachment link", async () => {
  const fixture = forwardingFixture();
  try {
    const upload = fixture.kernel.files.prepare(fixture.ownerActor, {
      filename: "independent.txt",
      idempotencyKey: "independent-upload",
      mimeType: "text/plain",
      roomId: fixture.source.roomId,
      size: 11,
    });
    await fixture.kernel.files.upload(
      fixture.ownerActor,
      upload.attachmentId,
      bytes("independent"),
    );
    const source = fixture.kernel.postRoomMessage(fixture.ownerActor, {
      attachmentIds: [upload.attachmentId],
      basedOnRoomSeq: fixture.kernel.sync(fixture.ownerActor, {
        consumerId: "independent-source-head",
        roomId: fixture.source.roomId,
      }).latestRoomSeq,
      body: "source",
      idempotencyKey: "independent-source",
      roomId: fixture.source.roomId,
    });
    const result = fixture.kernel.forwardMessages(fixture.ownerActor, {
      destinationRoomIds: [fixture.target.roomId],
      requestId: "independent-forward",
      sourceMessageIds: [source.event.aggregateId],
      sourceRoomId: fixture.source.roomId,
    });
    assert.equal(result.results[0]?.status, "delivered");
    const projectedId = fixture.kernel.listMessages(fixture.ownerActor, {
      roomId: fixture.target.roomId,
    }).messages[0]?.forwardedBundle?.items[0]?.attachments[0]?.attachmentId;
    assert.ok(projectedId);

    fixture.kernel.deleteWorkspaceRoom(fixture.ownerActor, {
      basedOnRoomSeq: fixture.kernel.sync(fixture.ownerActor, {
        consumerId: "delete-source-head",
        roomId: fixture.source.roomId,
      }).latestRoomSeq,
      idempotencyKey: "delete-forward-source",
      roomId: fixture.source.roomId,
    });
    assert.equal(
      existsSync(join(fixture.directory, "room-files", upload.attachmentId)),
      false,
    );
    assert.equal(
      existsSync(join(fixture.directory, "room-files", projectedId)),
      true,
    );
    const targetDownload = await fixture.kernel.files.download(
      fixture.ownerActor,
      projectedId,
    );
    assert.equal(await streamText(targetDownload.stream), "independent");

    fixture.kernel.deleteWorkspaceRoom(fixture.ownerActor, {
      basedOnRoomSeq: fixture.kernel.sync(fixture.ownerActor, {
        consumerId: "delete-target-head",
        roomId: fixture.target.roomId,
      }).latestRoomSeq,
      idempotencyKey: "delete-forward-target",
      roomId: fixture.target.roomId,
    });
    assert.equal(
      existsSync(join(fixture.directory, "room-files", projectedId)),
      false,
    );
  } finally {
    fixture.close();
  }
});

test("a failed multi-attachment projection rolls back its target message, rows, and hard links", async () => {
  const fixture = forwardingFixture();
  try {
    const uploads = [];
    for (const key of ["first", "missing"]) {
      const upload = fixture.kernel.files.prepare(fixture.ownerActor, {
        filename: `${key}.txt`,
        idempotencyKey: `rollback-upload-${key}`,
        mimeType: "text/plain",
        roomId: fixture.source.roomId,
        size: 5,
      });
      await fixture.kernel.files.upload(
        fixture.ownerActor,
        upload.attachmentId,
        bytes("hello"),
      );
      uploads.push(upload);
    }
    const source = fixture.kernel.postRoomMessage(fixture.ownerActor, {
      attachmentIds: uploads.map(({ attachmentId }) => attachmentId),
      basedOnRoomSeq: fixture.kernel.sync(fixture.ownerActor, {
        consumerId: "rollback-source-head",
        roomId: fixture.source.roomId,
      }).latestRoomSeq,
      body: "two attachments",
      idempotencyKey: "rollback-source",
      roomId: fixture.source.roomId,
    });
    unlinkSync(join(fixture.directory, "room-files", uploads[1]!.attachmentId));

    const requestId = "rollback-forward";
    const result = fixture.kernel.forwardMessages(fixture.ownerActor, {
      destinationRoomIds: [fixture.target.roomId],
      requestId,
      sourceMessageIds: [source.event.aggregateId],
      sourceRoomId: fixture.source.roomId,
    });
    assert.equal(result.results[0]?.status, "failed");
    assert.equal(
      fixture.kernel.listMessages(fixture.ownerActor, {
        roomId: fixture.target.roomId,
      }).messages.length,
      0,
    );
    assert.equal(
      fixture.kernel.files.list(fixture.ownerActor, {
        roomId: fixture.target.roomId,
      }).files.length,
      0,
    );
    const firstProjectedId = forwardedAttachmentProjectionId({
      actorId: fixture.kernel.getAuthenticatedPrincipal(fixture.ownerActor)
        .principalId,
      destinationRoomId: fixture.target.roomId,
      requestId,
      sourceAttachmentId: uploads[0]!.attachmentId,
    });
    assert.equal(
      existsSync(join(fixture.directory, "room-files", firstProjectedId)),
      false,
    );
  } finally {
    fixture.close();
  }
});

test("forwarding reports destination-local failures and rejects nested bundles", () => {
  const fixture = forwardingFixture();
  try {
    const source = fixture.kernel.postMessage(fixture.ownerActor, {
      body: "plain source",
      idempotencyKey: "plain-source",
      recipients: [],
      roomId: fixture.source.roomId,
    });
    const unavailable = fixture.kernel.createRoom(fixture.outsiderActor, {
      name: "Unavailable target",
      slug: "unavailable-target",
    });
    const partial = fixture.kernel.forwardMessages(fixture.ownerActor, {
      destinationRoomIds: [fixture.target.roomId, unavailable.roomId],
      requestId: "partial-forward",
      sourceMessageIds: [source.event.aggregateId],
      sourceRoomId: fixture.source.roomId,
    });
    assert.deepEqual(
      partial.results.map((item) =>
        item.status === "delivered" ? item.status : item.code,
      ),
      ["delivered", "destination_not_available"],
    );

    assert.throws(
      () =>
        fixture.kernel.forwardMessages(fixture.ownerActor, {
          destinationRoomIds: [fixture.target.roomId],
          note: "changed note",
          requestId: "partial-forward",
          sourceMessageIds: [source.event.aggregateId],
          sourceRoomId: fixture.source.roomId,
        }),
      /conflicts with its frozen source or destinations/u,
    );

    const forwardedMessageId =
      partial.results[0]?.status === "delivered"
        ? partial.results[0].messageId
        : "missing";
    assert.throws(
      () =>
        fixture.kernel.forwardMessages(fixture.ownerActor, {
          destinationRoomIds: [fixture.source.roomId],
          requestId: "nested-forward",
          sourceMessageIds: [forwardedMessageId],
          sourceRoomId: fixture.target.roomId,
        }),
      /forwarded source is not supported/u,
    );
  } finally {
    fixture.close();
  }
});

test("schema v46 preserves existing messages and adds durable forwarding storage", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-forwarding-migration-"));
  const databasePath = join(directory, "room.db");
  let kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  let actor = kernel.authenticateAccessToken(owner.accessToken);
  const source = kernel.createRoom(actor, {
    name: "Migration Source",
    slug: "migration-source",
  });
  const target = kernel.createRoom(actor, {
    name: "Migration Target",
    slug: "migration-target",
  });
  const original = kernel.postMessage(actor, {
    body: "preserve me",
    idempotencyKey: "migration-source-message",
    recipients: [],
    roomId: source.roomId,
  });
  kernel.close();

  const legacy = new DatabaseSync(databasePath);
  legacy.exec(
    "DROP TABLE message_forward_requests; ALTER TABLE messages DROP COLUMN forwarded_bundle_json; PRAGMA user_version = 45;",
  );
  legacy.close();

  kernel = new RoomKernel({ databasePath });
  try {
    kernel.initialize();
    actor = kernel.authenticateAccessToken(owner.accessToken);
    assert.equal(
      kernel.listMessages(actor, { roomId: source.roomId }).messages[0]?.body,
      "preserve me",
    );
    const forwarded = kernel.forwardMessages(actor, {
      destinationRoomIds: [target.roomId],
      requestId: "migration-forward",
      sourceMessageIds: [original.event.aggregateId],
      sourceRoomId: source.roomId,
    });
    assert.equal(forwarded.results[0]?.status, "delivered");
    assert.equal(
      kernel.listMessages(actor, { roomId: target.roomId }).messages[0]
        ?.forwardedBundle?.items[0]?.body,
      "preserve me",
    );
  } finally {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("one request freezes its snapshot across partial-delivery retries", () => {
  const fixture = forwardingFixture();
  try {
    fixture.kernel.updateAuthenticatedPrincipal(fixture.ownerActor, {
      avatarKey: null,
      displayName: "Original Owner",
    });
    const source = fixture.kernel.postMessage(fixture.ownerActor, {
      body: "frozen source",
      idempotencyKey: "frozen-source",
      recipients: [],
      roomId: fixture.source.roomId,
    });
    const delayedTarget = fixture.kernel.createRoom(fixture.ownerActor, {
      name: "Delayed Target",
      slug: "delayed-target",
    });
    const targetHead = fixture.kernel.sync(fixture.ownerActor, {
      afterSeq: 0,
      consumerId: "forward-archive-head",
      roomId: delayedTarget.roomId,
    }).latestRoomSeq;
    const archived = fixture.kernel.archiveWorkspaceRoom(fixture.ownerActor, {
      basedOnRoomSeq: targetHead,
      idempotencyKey: "forward-archive-target",
      roomId: delayedTarget.roomId,
    });

    const initial = fixture.kernel.forwardMessages(fixture.ownerActor, {
      destinationRoomIds: [fixture.target.roomId, delayedTarget.roomId],
      requestId: "frozen-request",
      sourceMessageIds: [source.event.aggregateId],
      sourceRoomId: fixture.source.roomId,
    });
    assert.deepEqual(
      initial.results.map((item) =>
        item.status === "delivered" ? item.status : item.code,
      ),
      ["delivered", "destination_read_only"],
    );
    fixture.kernel.updateAuthenticatedPrincipal(fixture.ownerActor, {
      avatarKey: null,
      displayName: "Renamed Owner",
    });
    fixture.kernel.unarchiveWorkspaceRoom(fixture.ownerActor, {
      basedOnRoomSeq: archived.event.roomSeq,
      idempotencyKey: "forward-unarchive-target",
      roomId: delayedTarget.roomId,
    });

    const retried = fixture.kernel.forwardMessages(fixture.ownerActor, {
      destinationRoomIds: [delayedTarget.roomId],
      requestId: "frozen-request",
      sourceMessageIds: [source.event.aggregateId],
      sourceRoomId: fixture.source.roomId,
    });
    assert.equal(retried.results[0]?.status, "delivered");
    const firstSnapshot = fixture.kernel.listMessages(fixture.ownerActor, {
      roomId: fixture.target.roomId,
    }).messages[0]?.forwardedBundle?.items[0];
    const retrySnapshot = fixture.kernel.listMessages(fixture.ownerActor, {
      roomId: delayedTarget.roomId,
    }).messages[0]?.forwardedBundle?.items[0];
    assert.equal(firstSnapshot?.actor.displayName, "Original Owner");
    assert.deepEqual(retrySnapshot, firstSnapshot);

    const unexpectedTarget = fixture.kernel.createRoom(fixture.ownerActor, {
      name: "Unexpected Target",
      slug: "unexpected-target",
    });
    assert.throws(
      () =>
        fixture.kernel.forwardMessages(fixture.ownerActor, {
          destinationRoomIds: [unexpectedTarget.roomId],
          requestId: "frozen-request",
          sourceMessageIds: [source.event.aggregateId],
          sourceRoomId: fixture.source.roomId,
        }),
      /conflicts with its frozen source or destinations/u,
    );
  } finally {
    fixture.close();
  }
});

function forwardingFixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-forwarding-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const outsider = kernel.provisionPrincipal({
    handle: "outsider",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({ handle: "agent", kind: "agent" });
  const ownerActor = kernel.authenticateAccessToken(owner.accessToken);
  const outsiderActor = kernel.authenticateAccessToken(outsider.accessToken);
  const agentActor = kernel.authenticateAccessToken(agent.accessToken);
  const source = kernel.createRoom(ownerActor, {
    name: "Source Room",
    slug: "source-room",
  });
  const target = kernel.createRoom(ownerActor, {
    name: "Target Room",
    slug: "target-room",
  });
  kernel.addMember(ownerActor, {
    principalId: agent.principal.principalId,
    roomId: target.roomId,
  });
  return {
    agentActor,
    close() {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    directory,
    kernel,
    outsiderActor,
    ownerActor,
    source,
    target,
  };
}
