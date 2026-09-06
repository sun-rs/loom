import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import type { DeviceAuthPrincipal } from "../device-auth";
import { RoomDomainError } from "./room-errors";
import { RoomLedger } from "./room-ledger";
import {
  ROOM_READ_RESPONSE_BYTE_LIMIT,
  RoomReadService,
} from "./room-read-service";

const CURSOR_KEY = {
  generation: "test-generation-1",
  secret: Buffer.from("room-read-test-secret-room-read-test-secret", "utf8"),
};

function localPrincipal(): DeviceAuthPrincipal {
  return { kind: "local" };
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "rah-room-read-"));
  const ledger = new RoomLedger(path.join(root, "rooms.sqlite"), {
    now: () => new Date("2026-09-05T08:00:00.000Z"),
    createId: (() => {
      let next = 0;
      return (prefix: string) => `${prefix}-${++next}`;
    })(),
  });
  const owner = ledger.ensureLocalHumanPrincipal({ handle: "owner" });
  ledger.provisionPrincipal({
    principalId: "agent-one",
    handle: "agent-one",
    kind: "agent",
  });
  const created = ledger.createRoom(owner.principalId, {
    roomId: "room-general",
    workspaceKey: "workspace-main",
    kind: "channel",
    slug: "general",
    name: "General",
    idempotencyKey: "create-general",
  });
  ledger.addMember(owner.principalId, {
    roomId: "room-general",
    principalId: "agent-one",
    role: "member",
    basedOnRoomSeq: created.event.roomSeq,
    idempotencyKey: "add-agent-one",
  });
  const service = new RoomReadService(ledger, { cursorKey: CURSOR_KEY });
  return { root, ledger, owner, service };
}

test("RoomReadService injects one daemon-owned Human across local, management, and paired clients", () => {
  const context = fixture();
  try {
    const local = context.service.bootstrap(localPrincipal(), { roomId: "room-general" });
    const management = context.service.bootstrap({ kind: "management" }, {
      roomId: "room-general",
    });
    const paired = context.service.bootstrap({
      kind: "device",
      device: {
        id: "phone-one",
        name: "Phone",
        createdAt: "2026-09-05T08:00:00.000Z",
        lastSeenAt: "2026-09-05T08:00:00.000Z",
      },
    }, { roomId: "room-general" });
    assert.deepEqual(management.snapshot, local.snapshot);
    assert.deepEqual(paired.snapshot, local.snapshot);
    assert.throws(
      () => context.service.bootstrap(null, { roomId: "room-general" }),
      (error: unknown) => error instanceof RoomDomainError && error.code === "unauthenticated",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService signs and scopes event cursors while preserving a frozen page chain", () => {
  const context = fixture();
  try {
    const bootstrap = context.service.bootstrap(localPrincipal(), {
      roomId: "room-general",
      limit: 1,
    });
    context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "one",
      idempotencyKey: "message-one",
    });
    context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "two",
      idempotencyKey: "message-two",
    });
    const first = context.service.readEvents(localPrincipal(), {
      roomId: "room-general",
      cursor: bootstrap.eventCursor,
      limit: 1,
    });
    assert.deepEqual(first.events.map((event) => event.type), ["message.posted"]);
    assert.equal(first.hasMore, true);

    context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "inserted-after-freeze",
      idempotencyKey: "message-three",
    });
    const second = context.service.readEvents(localPrincipal(), {
      roomId: "room-general",
      cursor: first.eventCursor,
      limit: 10,
    });
    assert.deepEqual(
      second.events.map((event) =>
        event.type === "message.posted" ? event.payload.body : event.type),
      ["two"],
    );
    assert.equal(second.hasMore, false);
    const live = context.service.readEvents(localPrincipal(), {
      roomId: "room-general",
      cursor: second.eventCursor,
      limit: 10,
    });
    assert.deepEqual(
      live.events.map((event) =>
        event.type === "message.posted" ? event.payload.body : event.type),
      ["inserted-after-freeze"],
    );

    const [body, signature] = first.eventCursor.split(".");
    const tamperedBody = `${body!.slice(0, -1)}${body!.endsWith("A") ? "B" : "A"}`;
    assert.throws(
      () => context.service.readEvents(localPrincipal(), {
        roomId: "room-general",
        cursor: `${tamperedBody}.${signature}`,
      }),
      (error: unknown) => error instanceof RoomDomainError && error.code === "invalid_argument",
    );
    assert.throws(
      () => context.service.readEvents(localPrincipal(), {
        roomId: "room-other",
        cursor: first.eventCursor,
      }),
      (error: unknown) => error instanceof RoomDomainError && error.code === "invalid_argument",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService traverses frozen older history without duplicates across new inserts", () => {
  const context = fixture();
  try {
    for (let index = 1; index <= 7; index += 1) {
      context.ledger.postMessage(context.owner.principalId, {
        roomId: "room-general",
        body: `message-${index}`,
        idempotencyKey: `message-${index}`,
      });
    }
    const bootstrap = context.service.bootstrap(localPrincipal(), {
      roomId: "room-general",
      limit: 2,
    });
    assert.deepEqual(bootstrap.recentMessages.map((message) => message.body), [
      "message-6",
      "message-7",
    ]);
    assert.ok(bootstrap.olderMessagesCursor);

    context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "message-8",
      idempotencyKey: "message-8",
    });
    const collected = [...bootstrap.recentMessages];
    let cursor: string | undefined = bootstrap.olderMessagesCursor;
    while (cursor) {
      const page = context.service.readOlderMessages(localPrincipal(), {
        roomId: "room-general",
        cursor,
        limit: 2,
      });
      collected.unshift(...page.messages);
      cursor = page.olderMessagesCursor;
    }
    assert.deepEqual(collected.map((message) => message.body), [
      "message-1",
      "message-2",
      "message-3",
      "message-4",
      "message-5",
      "message-6",
      "message-7",
    ]);
    assert.equal(new Set(collected.map((message) => message.messageId)).size, 7);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService Inbox is always scoped to the authenticated Human", () => {
  const context = fixture();
  try {
    context.ledger.postMessage("agent-one", {
      roomId: "room-general",
      body: "owner attention",
      mentionedPrincipalIds: [context.owner.principalId],
      idempotencyKey: "owner-attention",
    });
    const first = context.service.readInbox(localPrincipal(), { limit: 1 });
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0]?.participantId, context.owner.principalId);
    const replay = context.service.readInbox({ kind: "management" }, {
      cursor: first.inboxCursor,
      limit: 1,
    });
    assert.equal(replay.items.length, 0);
    const bootstrap = context.service.bootstrap(localPrincipal(), { roomId: "room-general" });
    assert.throws(
      () => context.service.readInbox(localPrincipal(), { cursor: bootstrap.eventCursor }),
      (error: unknown) => error instanceof RoomDomainError && error.code === "invalid_argument",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService establishes an atomic latest Inbox cursor without replaying backlog", () => {
  const context = fixture();
  try {
    context.ledger.postMessage("agent-one", {
      roomId: "room-general",
      body: "old attention",
      mentionedPrincipalIds: [context.owner.principalId],
      idempotencyKey: "old-attention",
    });
    const baseline = context.service.readInbox(localPrincipal(), { start: "latest" });
    assert.deepEqual(baseline.items, []);
    context.ledger.postMessage("agent-one", {
      roomId: "room-general",
      body: "new attention",
      mentionedPrincipalIds: [context.owner.principalId],
      idempotencyKey: "new-attention",
    });
    const after = context.service.readInbox(localPrincipal(), {
      cursor: baseline.inboxCursor,
      limit: 10,
    });
    assert.equal(after.items.length, 1);
    assert.equal(after.items[0]?.reason, "mention");
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService scopes and freezes opaque Room catalog cursors", () => {
  const context = fixture();
  try {
    for (const suffix of ["two", "three"]) {
      context.ledger.createRoom(context.owner.principalId, {
        roomId: `room-${suffix}`,
        workspaceKey: "workspace-main",
        kind: "channel",
        slug: suffix,
        name: suffix,
        idempotencyKey: `create-${suffix}`,
      });
    }
    const first = context.service.listRooms(localPrincipal(), { limit: 2 });
    assert.equal(first.mode, "room_list");
    assert.deepEqual(first.items.map((item) => item.room.roomId), ["room-three", "room-two"]);
    assert.equal(first.hasMore, true);
    assert.ok(first.roomListCursor);

    context.ledger.createRoom(context.owner.principalId, {
      roomId: "room-late",
      workspaceKey: "workspace-main",
      kind: "channel",
      slug: "late",
      name: "Late",
      idempotencyKey: "create-late",
    });
    const second = context.service.listRooms({ kind: "management" }, {
      cursor: first.roomListCursor,
      limit: 2,
    });
    assert.deepEqual(second.items.map((item) => item.room.roomId), ["room-general"]);
    assert.equal(second.hasMore, false);

    const [body, signature] = first.roomListCursor!.split(".");
    const tamperedBody = `${body!.slice(0, -1)}${body!.endsWith("A") ? "B" : "A"}`;
    assert.throws(
      () => context.service.listRooms(localPrincipal(), {
        cursor: `${tamperedBody}.${signature}`,
      }),
      (error: unknown) => error instanceof RoomDomainError && error.code === "invalid_argument",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService bounds Task pages and freezes them across later inserts", () => {
  const context = fixture();
  try {
    context.ledger.provisionPrincipal({
      principalId: "agent-reviewer",
      handle: "agent-reviewer",
      kind: "agent",
    });
    let head = context.ledger.addMember(context.owner.principalId, {
      roomId: "room-general",
      principalId: "agent-reviewer",
      role: "member",
      basedOnRoomSeq: 2,
      idempotencyKey: "add-agent-reviewer",
    }).event.roomSeq;
    for (let index = 1; index <= 5; index += 1) {
      const source = context.ledger.postMessage(context.owner.principalId, {
        roomId: "room-general",
        body: `task source ${index}`,
        idempotencyKey: `task-source-${index}`,
      });
      head = context.ledger.createTask(context.owner.principalId, {
        roomId: "room-general",
        sourceMessageId: source.value.messageId,
        title: `Task ${index}`,
        assigneeId: "agent-one",
        reviewerIds: ["agent-reviewer"],
        basedOnRoomSeq: source.event.roomSeq,
        idempotencyKey: `task-create-${index}`,
      }).event.roomSeq;
    }
    const first = context.service.listTasks(localPrincipal(), {
      roomId: "room-general",
      limit: 2,
    });
    assert.deepEqual(first.items.map((task) => task.taskNumber), [4, 5]);
    assert.equal(first.hasMore, true);
    assert.ok(first.taskListCursor);

    const lateSource = context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "late task source",
      idempotencyKey: "late-task-source",
    });
    context.ledger.createTask(context.owner.principalId, {
      roomId: "room-general",
      sourceMessageId: lateSource.value.messageId,
      title: "Late Task",
      assigneeId: "agent-one",
      reviewerIds: ["agent-reviewer"],
      basedOnRoomSeq: lateSource.event.roomSeq,
      idempotencyKey: "late-task-create",
    });
    const second = context.service.listTasks(localPrincipal(), {
      roomId: "room-general",
      cursor: first.taskListCursor!,
      limit: 2,
    });
    assert.deepEqual(second.items.map((task) => task.taskNumber), [2, 3]);
    assert.equal(second.hasMore, true);
    const third = context.service.listTasks(localPrincipal(), {
      roomId: "room-general",
      cursor: second.taskListCursor!,
      limit: 2,
    });
    assert.deepEqual(third.items.map((task) => task.taskNumber), [1]);
    assert.equal(third.hasMore, false);
    assert.equal(head > 0, true);
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService keeps one maximal-review Task readable without copying Review prose", () => {
  const context = fixture();
  try {
    const reviewerIds: string[] = [];
    let head = context.service.bootstrap(localPrincipal(), {
      roomId: "room-general",
    }).latestRoomSeq;
    for (let index = 0; index < 100; index += 1) {
      const principalId = `agent-reviewer-${index}`;
      reviewerIds.push(principalId);
      context.ledger.provisionPrincipal({
        principalId,
        handle: `reviewer-${index}`,
        kind: "agent",
      });
      head = context.ledger.addMember(context.owner.principalId, {
        roomId: "room-general",
        principalId,
        role: "member",
        basedOnRoomSeq: head,
        idempotencyKey: `add-max-reviewer-${index}`,
      }).event.roomSeq;
    }
    const source = context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "maximal review projection",
      idempotencyKey: "maximal-review-source",
    });
    const created = context.ledger.createTask(context.owner.principalId, {
      roomId: "room-general",
      sourceMessageId: source.value.messageId,
      title: "Maximal review projection remains readable",
      assigneeId: "agent-one",
      reviewerIds,
      basedOnRoomSeq: source.event.roomSeq,
      idempotencyKey: "maximal-review-task",
    });

    const database = new DatabaseSync(path.join(context.root, "rooms.sqlite"));
    const submissionId = "submission-maximal-review";
    const digest = `sha256:${"a".repeat(64)}`;
    const evidenceDigest = `sha256:${"b".repeat(64)}`;
    const createdAt = "2026-09-05T08:00:00.000Z";
    database.exec("BEGIN IMMEDIATE");
    database
      .prepare(
        `UPDATE room_tasks SET state = 'submitted', submission_summary = ?,
         submitted_at = ?, updated_at = ? WHERE task_id = ?`,
      )
      .run("frozen delivery", createdAt, createdAt, created.value.taskId);
    database
      .prepare(
        `INSERT INTO room_task_submissions(
          submission_id, task_id, room_id, submission_number, submission_digest,
          producer_id, message_id, summary, evidence_json, evidence_digest, created_at
        ) VALUES (?, ?, 'room-general', 1, ?, 'agent-one', ?, ?, ?, ?, ?)`,
      )
      .run(
        submissionId,
        created.value.taskId,
        digest,
        source.value.messageId,
        "frozen delivery",
        JSON.stringify({
          schemaVersion: 1,
          workspaceRoot: "/tmp/maximal-review",
          baseRevision: "base",
          headRevision: "head",
          patchDigest: digest,
          verificationDigest: evidenceDigest,
          observedAt: createdAt,
        }),
        evidenceDigest,
        createdAt,
      );
    const insertReview = database.prepare(
      `INSERT INTO room_task_reviews(
        review_id, task_id, room_id, submission_id, submission_digest,
        reviewer_id, disposition, summary, message_id, created_at
      ) VALUES (?, ?, 'room-general', ?, ?, ?, 'approved', ?, ?, ?)`,
    );
    for (const [index, reviewerId] of reviewerIds.entries()) {
      insertReview.run(
        `maximal-review-${index}`,
        created.value.taskId,
        submissionId,
        digest,
        reviewerId,
        "复".repeat(8_192),
        source.value.messageId,
        createdAt,
      );
    }
    database.exec("COMMIT");
    database.close();

    const response = context.service.listTasks(localPrincipal(), {
      roomId: "room-general",
      limit: 100,
    });
    const task = response.items.find(
      (candidate) => candidate.taskId === created.value.taskId,
    );
    assert.equal(task?.currentReviewStatuses?.length, 100);
    assert.equal(
      task?.currentReviewStatuses?.some((review) =>
        Object.hasOwn(review, "summary"),
      ),
      false,
    );
    assert.ok(
      Buffer.byteLength(JSON.stringify(response), "utf8") <=
        ROOM_READ_RESPONSE_BYTE_LIMIT,
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService keeps complete transport responses within the one MiB boundary", () => {
  const context = fixture();
  try {
    const initial = context.service.bootstrap(localPrincipal(), { roomId: "room-general" });
    const escapedBody = "\n\"\\\t\b".repeat(20_000);
    for (let index = 0; index < 8; index += 1) {
      context.ledger.postMessage(context.owner.principalId, {
        roomId: "room-general",
        body: escapedBody,
        idempotencyKey: `service-escaped-${index}`,
      });
    }
    const events = context.service.readEvents(localPrincipal(), {
      roomId: "room-general",
      cursor: initial.eventCursor,
      limit: 500,
    });
    const bootstrap = context.service.bootstrap(localPrincipal(), {
      roomId: "room-general",
      limit: 500,
    });
    assert.ok(Buffer.byteLength(JSON.stringify(events)) <= ROOM_READ_RESPONSE_BYTE_LIMIT);
    assert.ok(Buffer.byteLength(JSON.stringify(bootstrap)) <= ROOM_READ_RESPONSE_BYTE_LIMIT);
    assert.ok(events.events.length < 8);
    assert.ok(bootstrap.recentMessages.length < 8);
    assert.ok(events.events.every((event) =>
      event.type !== "message.posted" || event.payload.body === escapedBody));
    assert.ok(bootstrap.recentMessages.every((message) => message.body === escapedBody));
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService membership events atomically extend the client identity graph", () => {
  const context = fixture();
  try {
    const bootstrap = context.service.bootstrap(localPrincipal(), { roomId: "room-general" });
    context.ledger.provisionPrincipal({
      principalId: "agent-new",
      handle: "agent-new",
      kind: "agent",
      displayName: "New Agent",
    });
    context.ledger.addMember(context.owner.principalId, {
      roomId: "room-general",
      principalId: "agent-new",
      role: "member",
      basedOnRoomSeq: bootstrap.snapshotSeq,
      idempotencyKey: "add-agent-new",
    });
    const page = context.service.readEvents(localPrincipal(), {
      roomId: "room-general",
      cursor: bootstrap.eventCursor,
    });
    assert.equal(page.events.length, 1);
    const event = page.events[0]!;
    assert.equal(event.type, "membership.added");
    if (event.type !== "membership.added") throw new Error("expected membership event");
    assert.equal(event.payload.membership.principalId, "agent-new");
    assert.equal(event.payload.principal.principalId, "agent-new");
    assert.equal(event.payload.principal.displayName, "New Agent");
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});

test("RoomReadService returns resource_exhausted instead of a cursor-stalled page", () => {
  const context = fixture();
  try {
    const initial = context.service.bootstrap(localPrincipal(), { roomId: "room-general" });
    context.ledger.postMessage(context.owner.principalId, {
      roomId: "room-general",
      body: "x".repeat(900),
      idempotencyKey: "oversized-for-tiny-budget",
    });
    const constrained = new RoomReadService(context.ledger, {
      cursorKey: CURSOR_KEY,
      responseByteLimit: 1_024,
    });

    assert.throws(
      () => constrained.readEvents(localPrincipal(), {
        roomId: "room-general",
        cursor: initial.eventCursor,
      }),
      (error: unknown) =>
        error instanceof RoomDomainError && error.code === "resource_exhausted",
    );
    assert.throws(
      () => constrained.bootstrap(localPrincipal(), { roomId: "room-general" }),
      (error: unknown) =>
        error instanceof RoomDomainError && error.code === "resource_exhausted",
    );
  } finally {
    context.ledger.close();
    rmSync(context.root, { recursive: true, force: true });
  }
});
