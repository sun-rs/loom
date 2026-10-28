import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";

test("all is an ordinary optional channel, never a reserved workspace-wide lane", () => {
  const k = new RoomKernel({ databasePath: ":memory:" });
  k.initialize();
  try {
    const h = k.provisionPrincipal({ handle: "owner", kind: "human" });
    const a = k.authenticateAccessToken(h.accessToken);
    const w = k.createWorkspace(a, {
      name: "w",
      slug: "w",
      idempotencyKey: "w",
    });
    assert.equal(
      k
        .listRooms(a, { workspaceId: w.workspace.workspaceId })
        .filter((r) => r.kind === "channel").length,
      0,
    );
    const room = k.createWorkspaceRoom(a, {
      workspaceId: w.workspace.workspaceId,
      basedOnControlRoomSeq: w.event.roomSeq,
      name: "all",
      slug: "all",
      visibility: "private",
      kind: "channel",
      idempotencyKey: "all",
    }).room;
    const head = () =>
      k.sync(a, { roomId: room.roomId, consumerId: "test" }).latestRoomSeq;
    k.updateWorkspaceRoom(a, {
      roomId: room.roomId,
      basedOnRoomSeq: head(),
      idempotencyKey: "rename",
      name: "Renamed",
      visibility: "private",
    });
    k.archiveWorkspaceRoom(a, {
      roomId: room.roomId,
      basedOnRoomSeq: head(),
      idempotencyKey: "archive",
    });
    k.deleteWorkspaceRoom(a, {
      roomId: room.roomId,
      basedOnRoomSeq: head(),
      idempotencyKey: "delete",
    });
    k.initialize();
    assert.equal(
      k
        .listRooms(a, { workspaceId: w.workspace.workspaceId })
        .filter((r) => r.kind === "channel").length,
      0,
    );
  } finally {
    k.close();
  }
});

test("ordinary all never automatically enrolls Workspace agents", () => {
  const k = new RoomKernel({ databasePath: ":memory:" });
  k.initialize();
  try {
    const h = k.provisionPrincipal({ handle: "owner", kind: "human" }),
      a = k.authenticateAccessToken(h.accessToken);
    const w = k.createWorkspace(a, {
      name: "W",
      slug: "w",
      idempotencyKey: "w",
    });
    const head = (roomId: string) =>
      k.sync(a, { roomId, consumerId: "all-test" }).latestRoomSeq;
    const policy = k.createExecutionPolicy(a, {
      controlRoomId: w.controlRoom.roomId,
      basedOnRoomSeq: head(w.controlRoom.roomId),
      idempotencyKey: "policy",
      modelIntent: { fallback: "disabled" },
      preferred: [],
      required: {
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [],
        minimumIsolation: "none",
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: "retry",
        contentDigest: "sha256:" + "a".repeat(64),
        versionId: "v1",
      },
      sessionPolicy: "fresh",
    });
    const create = (handle: string) => {
      const p = k.provisionPrincipal({ handle, kind: "agent" }).principal;
      k.addMember(a, {
        roomId: w.controlRoom.roomId,
        principalId: p.principalId,
      });
      k.createAgentDefinition(a, {
        controlRoomId: w.controlRoom.roomId,
        basedOnRoomSeq: head(w.controlRoom.roomId),
        idempotencyKey: handle,
        participantId: p.principalId,
        executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
        instructionRefs: [],
        memoryPolicyRef: {
          artifactId: "memory",
          contentDigest: "sha256:" + "b".repeat(64),
          versionId: "v1",
        },
        role: "Agent",
        skillRefs: [],
      });
      return p;
    };
    const first = create("first");
    const room = k.createWorkspaceRoom(a, {
      workspaceId: w.workspace.workspaceId,
      basedOnControlRoomSeq: head(w.controlRoom.roomId),
      name: "all",
      slug: "all",
      visibility: "public",
      kind: "channel",
      idempotencyKey: "all",
    }).room;
    const ids = () =>
      k
        .listRoomMemberships(a, { roomId: room.roomId })
        .map((m) => m.principalId);
    assert.ok(
      !ids().includes(first.principalId),
      "channel creation must not enroll existing workspace agents",
    );
    const second = create("second");
    assert.ok(
      !ids().includes(second.principalId),
      "agent creation must not enroll it in all",
    );
    k.initialize();
    assert.ok(
      !ids().includes(first.principalId),
      "startup must not repair automatic membership",
    );
  } finally {
    k.close();
  }
});
