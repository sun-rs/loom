import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "rah-navigation-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "state.db") });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const outsider = kernel.provisionPrincipal({
    handle: "outsider",
    kind: "human",
  });
  const actor = kernel.authenticateAccessToken(owner.accessToken);
  const stranger = kernel.authenticateAccessToken(outsider.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    idempotencyKey: "workspace",
    name: "Navigation",
    slug: "navigation",
  });
  const head = (roomId: string) =>
    kernel.sync(actor, { consumerId: "head", roomId }).latestRoomSeq;
  const room = kernel.createWorkspaceRoom(actor, {
    basedOnControlRoomSeq: head(workspace.controlRoom.roomId),
    idempotencyKey: "room",
    kind: "channel",
    name: "Design",
    slug: "design",
    workspaceId: workspace.workspace.workspaceId,
  }).room;
  const posted = kernel.postRoomMessage(actor, {
    basedOnRoomSeq: head(room.roomId),
    body: "canonical target",
    idempotencyKey: "message",
    roomId: room.roomId,
  });
  const messageId = posted.event.aggregateId;
  return {
    actor,
    close() {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    kernel,
    messageId,
    room,
    stranger,
    workspaceId: workspace.workspace.workspaceId,
  };
}

test("navigation resolution rechecks canonical existence and Room ACL", () => {
  const f = fixture();
  try {
    assert.deepEqual(
      f.kernel.humanNavigation.resolve(f.actor, {
        target: {
          kind: "message",
          messageId: f.messageId,
          roomId: f.room.roomId,
        },
      }).target,
      {
        kind: "message",
        messageId: f.messageId,
        roomId: f.room.roomId,
      },
    );
    assert.throws(
      () =>
        f.kernel.humanNavigation.resolve(f.stranger, {
          target: {
            kind: "message",
            messageId: f.messageId,
            roomId: f.room.roomId,
          },
        }),
      /member|unavailable|forbidden/i,
    );
    assert.throws(() =>
      f.kernel.humanNavigation.resolve(f.actor, {
        target: {
          kind: "message",
          messageId: "missing-message",
          roomId: f.room.roomId,
        },
      }),
    );
  } finally {
    f.close();
  }
});

test("notification dismissals are per-Human/per-Workspace, idempotent and bounded", () => {
  const f = fixture();
  try {
    assert.deepEqual(
      f.kernel.humanNotifications.listDismissals(f.actor, {
        workspaceId: f.workspaceId,
      }).notificationIds,
      [],
      "listing/opening has no implicit read or dismissal side effect",
    );
    for (let index = 0; index < 105; index += 1) {
      f.kernel.humanNotifications.dismiss(f.actor, {
        idempotencyKey: `dismiss-${index}`,
        notificationId: `notice-${index}`,
        workspaceId: f.workspaceId,
      });
    }
    const dismissed = f.kernel.humanNotifications.listDismissals(f.actor, {
      workspaceId: f.workspaceId,
    }).notificationIds;
    assert.equal(dismissed.length, 100);
    assert.equal(dismissed.includes("notice-0"), false);
    assert.equal(dismissed.includes("notice-104"), true);
    const replay = f.kernel.humanNotifications.dismiss(f.actor, {
      idempotencyKey: "dismiss-104",
      notificationId: "notice-104",
      workspaceId: f.workspaceId,
    });
    assert.equal(replay.notificationIds.length, 100);
    assert.throws(() =>
      f.kernel.humanNotifications.listDismissals(f.stranger, {
        workspaceId: f.workspaceId,
      }),
    );
  } finally {
    f.close();
  }
});
