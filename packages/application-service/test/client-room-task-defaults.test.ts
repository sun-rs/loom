import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RoomKernel, createHumanApplicationPort } from "@rah-os/kernel";

import { ClientApplicationService } from "../src/index.ts";

function health() {
  return {
    apiVersion: 3 as const,
    buildVersion: "test",
    kernelSchemaVersion: 22,
    protocolVersion: 1,
    state: "online" as const,
    capabilities: {
      agentOnboard: true,
      agentRead: true,
      agentWrite: true,
      cursorAcknowledge: true,
      hints: false,
      inputRequestRead: true,
      inputRequestResolve: true,
      managedMcpRead: true,
      managedMcpWrite: true,
      memberRead: true,
      memberWrite: true,
      messageRead: true,
      messageWrite: true,
      roomRead: true,
      roomWrite: true,
      roomSync: true,
      taskRead: true,
      taskWrite: true,
      threadRead: true,
      threadWrite: true,
      workspaceRead: true,
      workspaceWrite: true,
    },
  };
}

test("Client rooms/update carries Room Task defaults and reads them back", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "rah-client-room-defaults-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "room.db") });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const agent = kernel.provisionPrincipal({
    handle: "defaults-agent",
    kind: "agent",
  });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    idempotencyKey: "workspace",
    name: "Defaults",
    slug: "defaults",
  });
  const room = kernel.createWorkspaceRoom(actor, {
    basedOnControlRoomSeq: kernel.sync(actor, {
      consumerId: "head",
      roomId: workspace.controlRoom.roomId,
    }).latestRoomSeq,
    idempotencyKey: "room",
    kind: "channel",
    name: "Defaults",
    slug: "defaults-room",
    workspaceId: workspace.workspace.workspaceId,
  }).room;
  kernel.addRoomMember(actor, {
    basedOnRoomSeq: kernel.sync(actor, {
      consumerId: "room-head",
      roomId: room.roomId,
    }).latestRoomSeq,
    idempotencyKey: "add-agent",
    principalId: agent.principal.principalId,
    role: "member",
    roomId: room.roomId,
  });
  const service = new ClientApplicationService({
    health,
    human: createHumanApplicationPort(kernel),
  });
  t.after(() => {
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
  });
  await service.start();
  try {
    const post = async (path: string, body: unknown) =>
      await fetch(`${service.origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${human.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });

    const updated = await post("/v3/client/rooms/update", {
      basedOnRoomSeq: kernel.sync(actor, {
        consumerId: "update-head",
        roomId: room.roomId,
      }).latestRoomSeq,
      idempotencyKey: "room-defaults",
      name: "Defaults",
      roomId: room.roomId,
      taskDefaults: {
        defaultAssigneeId: agent.principal.principalId,
        defaultCollaboratorIds: [],
        defaultReviewerIds: [],
      },
      visibility: "private",
    });
    assert.equal(updated.status, 200);
    const updatedBody = (await updated.json()) as {
      room: { taskDefaults?: { defaultAssigneeId?: string } };
    };
    assert.equal(
      updatedBody.room.taskDefaults?.defaultAssigneeId,
      agent.principal.principalId,
    );

    const listed = await post("/v3/client/rooms/list", {
      workspaceId: workspace.workspace.workspaceId,
    });
    assert.equal(listed.status, 200);
    const listedBody = (await listed.json()) as {
      rooms: {
        roomId: string;
        taskDefaults?: { defaultAssigneeId?: string };
      }[];
    };
    assert.equal(
      listedBody.rooms.find(({ roomId }) => roomId === room.roomId)
        ?.taskDefaults?.defaultAssigneeId,
      agent.principal.principalId,
    );

    const rejected = await post("/v3/client/rooms/update", {
      basedOnRoomSeq: kernel.sync(actor, {
        consumerId: "reject-head",
        roomId: room.roomId,
      }).latestRoomSeq,
      idempotencyKey: "room-defaults-invalid",
      name: "Defaults",
      roomId: room.roomId,
      taskDefaults: {
        defaultCollaboratorIds: [agent.principal.principalId],
        defaultReviewerIds: [],
      },
      visibility: "private",
    });
    assert.equal(rejected.status, 400);
  } finally {
    await service.close();
  }
});
