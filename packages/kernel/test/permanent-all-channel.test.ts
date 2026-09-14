import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";
test("all is a public permanent channel whose identity cannot be changed or removed", () => {
  const k = new RoomKernel({ databasePath: ":memory:" });
  k.initialize();
  try {
    const h = k.provisionPrincipal({ handle: "owner", kind: "human" }),
      a = k.authenticateAccessToken(h.accessToken);
    const w = k.createWorkspace(a, {
      name: "w",
      slug: "w",
      idempotencyKey: "w",
    });
    assert.throws(
      () =>
        k.createWorkspaceRoom(a, {
          workspaceId: w.workspace.workspaceId,
          basedOnControlRoomSeq: w.event.roomSeq,
          name: "all",
          slug: "all",
          visibility: "private",
          kind: "channel",
          idempotencyKey: "private-all",
        }),
      /permanent.*all/i,
    );
    const room = k.createWorkspaceRoom(a, {
      workspaceId: w.workspace.workspaceId,
      basedOnControlRoomSeq: w.event.roomSeq,
      name: "all",
      slug: "all",
      visibility: "public",
      kind: "channel",
      idempotencyKey: "all",
    }).room;
    const head = () =>
      k.sync(a, { roomId: room.roomId, consumerId: "test" }).latestRoomSeq;
    assert.throws(
      () =>
        k.archiveWorkspaceRoom(a, {
          roomId: room.roomId,
          basedOnRoomSeq: head(),
          idempotencyKey: "archive",
        }),
      /permanent.*all/i,
    );
    assert.throws(
      () =>
        k.deleteWorkspaceRoom(a, {
          roomId: room.roomId,
          basedOnRoomSeq: head(),
          idempotencyKey: "delete",
        }),
      /permanent.*all/i,
    );
    for (const change of [
      { name: "renamed", visibility: "public" as const },
      { name: "all", visibility: "private" as const },
    ]) {
      assert.throws(
        () =>
          k.updateWorkspaceRoom(a, {
            roomId: room.roomId,
            basedOnRoomSeq: head(),
            idempotencyKey: change.name + change.visibility,
            ...change,
          }),
        /permanent.*all/i,
      );
    }
    assert.equal(
      k
        .listRooms(a, { workspaceId: w.workspace.workspaceId })
        .find((r) => r.roomId === room.roomId)?.name,
      "all",
    );
  } finally {
    k.close();
  }
});

test("all automatically contains Workspace Agents and rejects manual membership edits", () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-all-members-"));
  const databasePath = join(dir, "room.db");
  const k = new RoomKernel({ databasePath });
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
    assert.throws(
      () =>
        k.createWorkspaceRoom(a, {
          workspaceId: w.workspace.workspaceId,
          basedOnControlRoomSeq: head(w.controlRoom.roomId),
          name: "all",
          slug: "all",
          visibility: "public",
          kind: "channel",
          idempotencyKey: "manual-all",
          initialAgentParticipantIds: [first.principalId],
        }),
      /permanent.*all/i,
    );
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
      ids().includes(first.principalId),
      "existing Agents join on channel creation",
    );
    const second = create("second");
    assert.ok(
      ids().includes(second.principalId),
      "new Agents join immediately",
    );
    // Simulate a pre-upgrade missing membership in persisted state.
    const imported = new DatabaseSync(databasePath);
    imported
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(room.roomId, first.principalId);
    imported.close();
    k.initialize();
    assert.ok(
      ids().includes(first.principalId),
      "startup repairs a missing member without rebuilding the Room",
    );
    const seq = head(room.roomId);
    k.initialize();
    assert.equal(
      head(room.roomId),
      seq,
      "startup reconciliation is idempotent",
    );
    for (const p of [first, second])
      assert.throws(
        () =>
          k.removeRoomMember(a, {
            roomId: room.roomId,
            principalId: p.principalId,
            basedOnRoomSeq: head(room.roomId),
            idempotencyKey: "remove-" + p.handle,
          }),
        /permanent.*all/i,
      );
    assert.throws(
      () =>
        k.addRoomMember(a, {
          roomId: room.roomId,
          principalId: first.principalId,
          role: "member",
          basedOnRoomSeq: head(room.roomId),
          idempotencyKey: "add",
        }),
      /permanent.*all/i,
    );

    assert.throws(
      () =>
        k.addMember(a, { roomId: room.roomId, principalId: first.principalId }),
      /permanent.*all/i,
    );
    const definition = k
      .listAgentCatalog(a, { controlRoomId: w.controlRoom.roomId })
      .find(
        (entry) => entry.definition.participantId === first.principalId,
      )!.definition;
    k.manageWorkspaceAgent(a, {
      action: "set_state",
      agentDefinitionId: definition.agentDefinitionId,
      basedOnRoomSeq: head(w.controlRoom.roomId),
      idempotencyKey: "stop-first",
      state: "disabled",
    });
    assert.ok(
      ids().includes(first.principalId),
      "stopped Agents remain members",
    );
    k.manageWorkspaceAgent(a, {
      action: "set_state",
      agentDefinitionId: definition.agentDefinitionId,
      basedOnRoomSeq: head(w.controlRoom.roomId),
      idempotencyKey: "delete-first",
      state: "tombstoned",
    });
    k.initialize();
    assert.ok(
      !ids().includes(first.principalId),
      "deleted identities must not be resurrected",
    );
  } finally {
    k.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
