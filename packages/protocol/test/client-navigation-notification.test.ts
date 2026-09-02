import assert from "node:assert/strict";
import test from "node:test";

import {
  ClientNavigationResolveRequestSchema,
  ClientNavigationResolveResponseSchema,
  ClientNotificationDismissRequestSchema,
  ClientNotificationListResponseSchema,
  NavigationTargetSchema,
} from "../src/index.ts";

test("typed navigation targets cover canonical product identities and reject URL-shaped guesses", () => {
  const targets = [
    { kind: "room", roomId: "room-design" },
    { kind: "message", roomId: "room-design", messageId: "message-1" },
    {
      kind: "thread",
      roomId: "room-design",
      threadId: "thread-1",
      rootMessageId: "message-1",
    },
    { kind: "task", roomId: "room-design", taskId: "task-1" },
    {
      kind: "input_request",
      roomId: "room-design",
      inputRequestId: "input-1",
    },
    { kind: "agent", agentDefinitionId: "agent-alice", tab: "activity" },
    { kind: "computer", hostId: "host-mac" },
    { kind: "artifact", roomId: "room-design", artifactId: "artifact-1" },
  ] as const;
  for (const target of targets) {
    assert.deepEqual(NavigationTargetSchema.parse(target), target);
    assert.deepEqual(
      ClientNavigationResolveRequestSchema.parse({ target }).target,
      target,
    );
  }
  assert.throws(() =>
    NavigationTargetSchema.parse({ kind: "url", href: "/?room=guessed" }),
  );
  assert.throws(() =>
    ClientNavigationResolveResponseSchema.parse({
      target: { kind: "message", roomId: "room-design" },
    }),
  );
});

test("system notifications carry a typed target and explicit dismissal without read side effects", () => {
  const notification = {
    notificationId:
      "computer-offline:host-mac:instance-1:2026-09-01T00:00:00.000Z",
    kind: "computer_offline",
    target: { kind: "computer", hostId: "host-mac" },
    dismissible: true,
    computerName: "Mac Studio",
    lastSeenAt: "2026-09-01T00:00:00.000Z",
  } as const;
  assert.deepEqual(
    ClientNotificationListResponseSchema.parse({
      notifications: [notification],
    }).notifications[0],
    notification,
  );
  assert.deepEqual(
    ClientNotificationDismissRequestSchema.parse({
      idempotencyKey: "dismiss-offline-1",
      notificationId: notification.notificationId,
      workspaceId: "workspace-1",
    }).notificationId,
    notification.notificationId,
  );
});
