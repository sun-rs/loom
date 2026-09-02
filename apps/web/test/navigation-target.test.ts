import assert from "node:assert/strict";
import test from "node:test";

import {
  navigationPresentation,
  navigationSearch,
  roomTabFromSearch,
  shouldHandleClientNavigation,
} from "../src/navigation-target.ts";

test("typed targets encode reload-safe internal navigation without public share state", () => {
  assert.equal(
    navigationSearch(
      {
        target: {
          kind: "message",
          messageId: "message-1",
          roomId: "room-1",
          rootMessageId: "root-1",
          threadId: "thread-1",
        },
        surface: "activity",
      },
      "?surface=activity&filter=mentions",
    ),
    "?surface=activity&filter=mentions&target=message&room=room-1&message=message-1&threadId=thread-1&thread=room-1%3Aroot-1",
  );
  assert.equal(
    navigationSearch({
      target: { kind: "agent", agentDefinitionId: "agent-1", tab: "activity" },
    }),
    "?target=agent&surface=agents&agent=agent-1&agentTab=activity",
  );
  assert.equal(
    navigationSearch({ target: { kind: "computer", hostId: "host-1" } }),
    "?target=computer&surface=computers&computer=host-1",
  );
  assert.equal(
    navigationSearch({
      target: {
        kind: "input_request",
        inputRequestId: "input-1",
        roomId: "room-1",
        taskId: "task-1",
      },
    }),
    "?target=input_request&room=room-1&inputRequest=input-1",
  );
  assert.equal(
    navigationSearch({
      target: {
        artifactId: "artifact-1",
        kind: "artifact",
        messageId: "message-1",
        roomId: "room-1",
      },
    }),
    "?target=artifact&room=room-1&roomTab=files&artifact=artifact-1&message=message-1",
  );
});

test("typed permalinks preserve native modified and non-primary browser navigation", () => {
  assert.equal(
    shouldHandleClientNavigation({
      altKey: false,
      button: 0,
      ctrlKey: false,
      defaultPrevented: false,
      metaKey: false,
      shiftKey: false,
    }),
    true,
  );
  for (const event of [
    { button: 1 },
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { defaultPrevented: true },
  ]) {
    assert.equal(
      shouldHandleClientNavigation({
        altKey: false,
        button: 0,
        ctrlKey: false,
        defaultPrevented: false,
        metaKey: false,
        shiftKey: false,
        ...event,
      }),
      false,
    );
  }
});

test("resolved target presentation maps to the existing Raft surfaces and tabs", () => {
  assert.deepEqual(
    navigationPresentation({
      kind: "task",
      roomId: "room-1",
      taskId: "task-1",
      threadId: "thread-1",
      rootMessageId: "root-1",
    }),
    {
      roomId: "room-1",
      surface: "room",
      tab: "tasks",
      threadRootMessageId: "root-1",
    },
  );
  assert.equal(roomTabFromSearch("?room=x&roomTab=files"), "files");
  assert.equal(roomTabFromSearch("?room=x&roomTab=unknown"), "chat");
  assert.deepEqual(
    navigationPresentation({
      inputRequestId: "input-1",
      kind: "input_request",
      roomId: "room-1",
      taskId: "task-1",
    }),
    {
      inputRequestId: "input-1",
      roomId: "room-1",
      surface: "room",
      tab: "chat",
    },
  );
});

test("Activity Room targets leave the feed while Thread targets retain its background", () => {
  assert.equal(
    navigationSearch(
      {
        target: { kind: "room", roomId: "room-1" },
        surface: "activity",
      },
      "?surface=activity&filter=mentions",
    ),
    "?target=room&room=room-1",
  );
  assert.deepEqual(
    navigationPresentation({ kind: "room", roomId: "room-1" }, "activity"),
    { roomId: "room-1", surface: "room", tab: "chat" },
  );
  assert.equal(
    navigationPresentation(
      {
        kind: "thread",
        roomId: "room-1",
        threadId: "thread-1",
        rootMessageId: "root-1",
      },
      "activity",
    ).surface,
    "activity",
  );
});
