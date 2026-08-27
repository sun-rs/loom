import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { RuntimeAdapter } from "@rah-os/agent-host";

import { RahCore } from "../src/index.ts";

test("the Core package dependency boundary excludes daemon, transport, and UI shells", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { dependencies?: Record<string, string> };
  assert.deepEqual(Object.keys(packageJson.dependencies ?? {}).sort(), [
    "@rah-os/agent-host",
    "@rah-os/kernel",
    "@rah-os/protocol",
  ]);
});

test("RahCore capacity policy fails closed on invalid or ambiguous admin limits", () => {
  assert.throws(
    () =>
      new RahCore({
        databasePath: ":memory:",
        placementCapacityPolicy: { defaultMaxConcurrent: 0 },
      }),
    /positive integer/,
  );
  assert.throws(
    () =>
      new RahCore({
        databasePath: ":memory:",
        placementCapacityPolicy: {
          hostLimits: [
            { hostId: "duplicate-host", maxConcurrent: 1 },
            { hostId: "duplicate-host", maxConcurrent: 2 },
          ],
        },
      }),
    /duplicate Host capacity limit/,
  );
});

test("RahCore is a headless lifecycle boundary over canonical Room state and multi-lane execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-os-core-"));
  try {
    const core = RahCore.open({
      databasePath: join(directory, "room.db"),
      placementCapacityPolicy: { defaultMaxConcurrent: 2 },
    });
    const human = core.kernel.provisionPrincipal({
      handle: "core-human",
      kind: "human",
    });
    const agent = core.kernel.provisionPrincipal({
      handle: "core-agent",
      kind: "agent",
    });
    const actor = core.human.authenticateHumanAccessToken(human.accessToken);
    const workspace = core.human.createWorkspace(actor, {
      idempotencyKey: "core-workspace-create",
      name: "Core SDK Workspace",
      slug: "core-sdk-workspace",
    });
    const roomCreated = core.human.createRoom(actor, {
      basedOnControlRoomSeq: workspace.event.roomSeq,
      idempotencyKey: "core-room-create",
      kind: "channel",
      name: "Core SDK Room",
      slug: "core-sdk-room",
      workspaceId: workspace.workspace.workspaceId,
    });
    const room = roomCreated.room;
    core.human.addRoomMember(actor, {
      basedOnRoomSeq: 1,
      idempotencyKey: "core-agent-member-add",
      principalId: agent.principal.principalId,
      role: "member",
      roomId: room.roomId,
    });
    const credential = core.kernel.provisionHostCredential({
      hostId: "core-host",
      participantIds: [agent.principal.principalId],
    });
    const host = core.kernel.authenticateHostAccessToken(
      credential.accessToken,
    );
    const runtime: RuntimeAdapter = {
      async cancel() {
        return { code: 0 };
      },
      async probe() {
        return { available: true };
      },
      async reap() {
        return { code: 0 };
      },
      async start() {
        return { runId: "unused-core-test-run" };
      },
    };
    const runner = core.createMultiLaneAgentHost({
      capacity: 2,
      host,
      leaseMs: 30_000,
      placementRuntimeResolver: () => runtime,
      runtime,
    });

    assert.equal(core.state, "open");
    assert.equal(runner.capacity, 2);
    assert.equal(Object.isFrozen(core.human), true);
    assert.deepEqual(Object.keys(core.human).sort(), [
      "acknowledgeCursor",
      "addRoomMember",
      "assignTask",
      "authenticateHumanAccessToken",
      "cancelTask",
      "completeTask",
      "createRoom",
      "createTask",
      "createThread",
      "createWorkspace",
      "getAuthenticatedPrincipal",
      "getWorkspaceAgentManagementView",
      "listAgentCatalog",
      "listInputRequests",
      "listMessages",
      "listRoomAgentActivity",
      "listRoomMemberships",
      "listRooms",
      "listTasks",
      "listThreads",
      "listWorkspaces",
      "manageWorkspaceAgent",
      "onboardAgentToRoom",
      "postRoomMessage",
      "provisionWorkspaceAgent",
      "removeRoomMember",
      "replyThread",
      "resolveInputRequest",
      "setRoomMemberRole",
      "sync",
      "unblockTask",
    ]);
    assert.equal("provisionHostCredential" in core.human, false);
    assert.equal("listActivations" in core.human, false);
    assert.equal(
      core.human.listWorkspaces(actor)[0]?.controlRoomId,
      workspace.controlRoom.roomId,
    );
    assert.deepEqual(
      core.human.listRooms(actor).map((visibleRoom) => visibleRoom.roomId),
      [workspace.controlRoom.roomId, room.roomId],
    );
    assert.equal(
      core.human.sync(actor, {
        afterSeq: 0,
        consumerId: "core-sdk-test",
        roomId: room.roomId,
      }).snapshot?.room.name,
      "Core SDK Room",
    );

    core.close();
    assert.equal(core.state, "closed");
    assert.throws(() => core.human, /RahCore is not open/);
    assert.throws(() => core.kernel, /RahCore is not open/);
    assert.throws(() => core.initialize(), /cannot be reopened/);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
