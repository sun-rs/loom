import assert from "node:assert/strict";
import test from "node:test";

import type {
  RoomEventReadResponse,
  RoomMessage,
  RoomTask,
} from "@rah/runtime-protocol";
import {
  RoomProjectionController,
  type RoomProjectionPorts,
} from "./room-projection";

const CREATED_AT = "2026-09-06T08:00:00.000Z";

function message(index: number): RoomMessage {
  return {
    messageId: `message-${index}`,
    roomId: "room-one",
    roomSeq: index,
    actorId: "human-owner",
    body: `message ${index}`,
    createdAt: CREATED_AT,
  };
}

function task(index: number): RoomTask {
  return {
    taskId: `task-${index}`,
    roomId: "room-one",
    taskNumber: index,
    sourceMessageId: "message-1",
    threadId: "thread-1",
    creatorId: "human-owner",
    assigneeId: "agent-worker",
    reviewerIds: ["agent-reviewer"],
    dependencyTaskIds: [],
    title: `task ${index}`,
    state: "todo",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function fixture(overrides: Partial<RoomProjectionPorts> = {}) {
  const ports: RoomProjectionPorts = {
    bootstrap: async () => ({
      mode: "latest_bootstrap",
      snapshot: {
        room: {
          roomId: "room-one",
          workspaceKey: "workspace-main",
          kind: "channel",
          slug: "general",
          name: "General",
          visibility: "private",
          createdAt: CREATED_AT,
        },
        memberships: [
          {
            roomId: "room-one",
            principalId: "human-owner",
            role: "owner",
            joinedAt: CREATED_AT,
          },
        ],
        principals: [
          {
            principalId: "human-owner",
            handle: "owner",
            kind: "human",
            createdAt: CREATED_AT,
          },
        ],
      },
      snapshotSeq: 10_000,
      latestRoomSeq: 10_000,
      recentMessages: Array.from({ length: 200 }, (_, offset) =>
        message(9_801 + offset),
      ),
      eventCursor: "cursor-10000",
      olderMessagesCursor: "older-9801",
    }),
    readEvents: async () => ({
      mode: "event_page",
      events: [],
      latestRoomSeq: 10_000,
      hasMore: false,
      eventCursor: "cursor-10000",
    }),
    readOlderMessages: async () => ({
      mode: "older_messages",
      messages: Array.from({ length: 100 }, (_, offset) =>
        message(9_701 + offset),
      ),
      hasMore: true,
      olderMessagesCursor: "older-9701",
    }),
    listTasks: async () => ({
      mode: "task_list",
      roomId: "room-one",
      items: [],
      hasMore: false,
    }),
    ...overrides,
  };
  return ports;
}

test("Room projection bootstraps from the latest bounded window and pages upward once", async () => {
  const controller = new RoomProjectionController({
    ports: fixture(),
    maxMessages: 300,
  });
  await controller.open("room-one");
  assert.equal(controller.state().messages.length, 200);
  assert.equal(controller.state().messages[0]?.roomSeq, 9_801);
  await controller.loadOlder();
  assert.equal(controller.state().messages.length, 300);
  assert.equal(controller.state().messages[0]?.roomSeq, 9_701);
  assert.equal(controller.state().olderMessagesCursor, "older-9701");
  controller.close();
});

test("historical paging never destroys the retained latest tail", async () => {
  let olderPage = 0;
  const controller = new RoomProjectionController({
    ports: fixture({
      readOlderMessages: async () => {
        olderPage += 1;
        const first = olderPage === 1 ? 9_701 : 9_601;
        return {
          mode: "older_messages",
          messages: Array.from({ length: 100 }, (_, offset) =>
            message(first + offset),
          ),
          hasMore: olderPage < 2,
          ...(olderPage < 2 ? { olderMessagesCursor: "older-9701" } : {}),
        };
      },
      readEvents: async () => ({
        mode: "event_page",
        events: [
          {
            eventId: "event-10001",
            roomId: "room-one",
            roomSeq: 10_001,
            actorId: "human-owner",
            aggregateType: "message",
            aggregateId: "message-10001",
            schemaVersion: 1,
            createdAt: CREATED_AT,
            type: "message.posted",
            payload: {
              body: "message 10001",
              attention: [],
              createdAt: CREATED_AT,
            },
          },
        ],
        latestRoomSeq: 10_001,
        hasMore: false,
        eventCursor: "cursor-10001",
      }),
    }),
    maxMessages: 300,
  });

  await controller.open("room-one");
  await controller.loadOlder();
  await controller.loadOlder();
  assert.equal(controller.state().viewingOlderMessages, true);
  assert.equal(controller.state().messages[0]?.roomSeq, 9_601);
  assert.equal(controller.state().messages.at(-1)?.roomSeq, 9_900);

  await controller.sync();
  assert.equal(controller.state().messages.at(-1)?.roomSeq, 9_900);
  controller.returnToLatest();
  assert.equal(controller.state().viewingOlderMessages, false);
  assert.equal(controller.state().messages[0]?.roomSeq, 9_801);
  assert.equal(controller.state().messages.at(-1)?.roomSeq, 10_001);
  controller.close();
});

test("Task bootstrap respects the daemon page limit and retains a bounded historical window", async () => {
  const limits: number[] = [];
  let page = 0;
  const controller = new RoomProjectionController({
    ports: fixture({
      listTasks: async (request) => {
        limits.push(request.limit ?? 0);
        page += 1;
        const first = page === 1 ? 201 : page === 2 ? 101 : 1;
        return {
          mode: "task_list",
          roomId: "room-one",
          items: Array.from({ length: 100 }, (_, offset) =>
            task(first + offset),
          ),
          hasMore: page < 3,
          ...(page < 3 ? { taskListCursor: `tasks-${first}` } : {}),
        };
      },
    }),
    maxTasks: 150,
  });

  await controller.open("room-one");
  await controller.loadOlderTasks();
  await controller.loadOlderTasks();
  assert.deepEqual(limits, [100, 100, 100]);
  assert.equal(controller.state().tasks.length, 150);
  assert.equal(controller.state().tasks[0]?.taskNumber, 1);
  assert.equal(controller.state().tasks.at(-1)?.taskNumber, 150);
  assert.equal(controller.state().viewingOlderTasks, true);

  controller.returnToLatestTasks();
  assert.equal(controller.state().tasks[0]?.taskNumber, 201);
  assert.equal(controller.state().tasks.at(-1)?.taskNumber, 300);
  assert.equal(controller.state().viewingOlderTasks, false);
  controller.close();
});

test("Room projection caps catch-up work and never retains event history", async () => {
  let pages = 0;
  const readEvents: RoomProjectionPorts["readEvents"] = async (_request) => {
    pages += 1;
    const start = 10_000 + (pages - 1) * 200;
    const events: RoomEventReadResponse["events"] = Array.from(
      { length: 200 },
      (_, offset) => {
        const current = start + offset + 1;
        return {
          eventId: `event-${current}`,
          roomId: "room-one",
          roomSeq: current,
          actorId: "human-owner",
          aggregateType: "message" as const,
          aggregateId: `message-${current}`,
          schemaVersion: 1 as const,
          createdAt: CREATED_AT,
          type: "message.posted" as const,
          payload: {
            body: `message ${current}`,
            attention: [],
            createdAt: CREATED_AT,
          },
        };
      },
    );
    return {
      mode: "event_page",
      events,
      latestRoomSeq: 20_000,
      hasMore: true,
      eventCursor: `cursor-${start + 200}`,
    };
  };
  const controller = new RoomProjectionController({
    ports: fixture({ readEvents }),
    maxMessages: 300,
  });
  await controller.open("room-one");
  await controller.sync(4);
  assert.equal(pages, 4);
  assert.equal(controller.state().messages.length, 300);
  assert.equal(controller.state().messages.at(-1)?.roomSeq, 10_800);
  assert.equal(controller.state().observedRoomSeq, 10_800);
  assert.equal(controller.state().canonicalHeadSeq, 20_000);
  assert.equal(Object.hasOwn(controller.state(), "events"), false);
  controller.close();
});

test("late Room open completion cannot replace a newer selection", async () => {
  let releaseFirst!: () => void;
  const first = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const base = fixture();
  const controller = new RoomProjectionController({
    ports: {
      ...base,
      bootstrap: async (request, signal) => {
        if (request.roomId === "room-one") await first;
        const result = await base.bootstrap(request, signal);
        return {
          ...result,
          snapshot: {
            ...result.snapshot,
            room: { ...result.snapshot.room, roomId: request.roomId },
            memberships: result.snapshot.memberships.map((item) => ({
              ...item,
              roomId: request.roomId,
            })),
          },
        };
      },
      listTasks: async ({ roomId }) => ({
        mode: "task_list",
        roomId,
        items: [],
        hasMore: false,
      }),
    },
  });
  const older = controller.open("room-one");
  const newer = controller.open("room-two");
  await newer;
  releaseFirst();
  await older;
  assert.equal(controller.state().roomId, "room-two");
  controller.close();
});
