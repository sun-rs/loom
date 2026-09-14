import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { RoomKernel } from "../src/index.ts";

test("hidden all disappears from lists and denies Human/Agent reads and writes; restoring preserves history", () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-hidden-all-"));
  const databasePath = join(directory, "core.sqlite");
  let k = new RoomKernel({ databasePath });
  k.initialize();
  try {
    const h = k.provisionPrincipal({ handle: "owner", kind: "human" });
    let a = k.authenticateAccessToken(h.accessToken);
    const w = k.createWorkspace(a, {
      name: "w",
      slug: "w",
      idempotencyKey: "w",
    });
    const r = k.createWorkspaceRoom(a, {
      workspaceId: w.workspace.workspaceId,
      basedOnControlRoomSeq: w.event.roomSeq,
      name: "all",
      slug: "all",
      visibility: "public",
      kind: "channel",
      idempotencyKey: "all",
    }).room;
    const head = () =>
      k.sync(a, { roomId: w.controlRoom.roomId, consumerId: "test" })
        .latestRoomSeq;
    const agent = k.provisionPrincipal({ handle: "agent", kind: "agent" });
    k.addMember(a, {
      roomId: w.controlRoom.roomId,
      principalId: agent.principal.principalId,
    });
    const policy = k.createExecutionPolicy(a, {
      controlRoomId: w.controlRoom.roomId,
      basedOnRoomSeq: head(),
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
    const definition = k.createAgentDefinition(a, {
      controlRoomId: w.controlRoom.roomId,
      basedOnRoomSeq: head(),
      idempotencyKey: "agent",
      participantId: agent.principal.principalId,
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
    const aa = k.authenticateAccessToken(agent.accessToken);
    k.postMessage(aa, {
      roomId: r.roomId,
      body: "@owner system channel activity",
      recipients: [],
      basedOnRoomSeq: k.sync(aa, {
        roomId: r.roomId,
        consumerId: "activity-test",
      }).latestRoomSeq,
      idempotencyKey: "activity-test",
    });
    const activity = () =>
      k.listHumanActivity(a, { workspaceId: w.workspace.workspaceId });
    assert.equal(activity().items.length, 1);
    const before = k.sync(a, { roomId: r.roomId, consumerId: "test" });
    const command = {
      workspaceId: w.workspace.workspaceId,
      basedOnRoomSeq: head(),
      idempotencyKey: "hide",
      hidden: true,
    };
    assert.throws(
      () => k.updateSystemChannelVisibility(aa, command),
      /Human|member/i,
    );
    const changed = k.updateSystemChannelVisibility(a, command);
    assert.equal(changed.hidden, true);
    assert.equal(
      activity().items.length,
      0,
      "hidden channel activity disappears",
    );
    assert.equal(
      k.updateSystemChannelVisibility(a, command).deduplicated,
      true,
    );
    assert.throws(
      () => k.updateSystemChannelVisibility(a, { ...command, hidden: false }),
      /idempotency/i,
    );
    assert.throws(
      () =>
        k.updateSystemChannelVisibility(a, {
          ...command,
          hidden: false,
          idempotencyKey: "stale",
        }),
      /stale|sequence|context/i,
    );
    assert.equal(
      k
        .listWorkspaceAgentRooms(a, {
          agentDefinitionId: definition.definition.agentDefinitionId,
        })
        .some((x) => x.roomId === r.roomId),
      false,
    );
    for (const actor of [a, aa]) {
      assert.throws(
        () =>
          k.postMessage(actor, {
            roomId: r.roomId,
            body: "forbidden",
            recipients: [],
            basedOnRoomSeq: before.latestRoomSeq,
            idempotencyKey: "hidden-send",
          }),
        /hidden|unavailable|member/i,
      );
      assert.equal(
        k
          .listRooms(actor, { workspaceId: w.workspace.workspaceId })
          .some((x) => x.roomId === r.roomId),
        false,
      );
      assert.throws(
        () => k.sync(actor, { roomId: r.roomId, consumerId: "test" }),
        /hidden|unavailable|member/i,
      );
      assert.throws(
        () => k.listMessages(actor, { roomId: r.roomId }),
        /hidden|unavailable|member/i,
      );
    }
    assert.equal(
      k.getSystemChannelVisibility(a, { workspaceId: w.workspace.workspaceId })
        .hidden,
      true,
    );
    k.close();
    k = new RoomKernel({ databasePath });
    k.initialize();
    a = k.authenticateAccessToken(h.accessToken);
    assert.equal(
      k.getSystemChannelVisibility(a, { workspaceId: w.workspace.workspaceId })
        .hidden,
      true,
    );
    k.updateSystemChannelVisibility(a, {
      ...command,
      hidden: false,
      basedOnRoomSeq: head(),
      idempotencyKey: "restore",
    });
    assert.equal(
      activity().items.length,
      1,
      "restoring makes retained activity visible again",
    );
    assert.equal(
      k
        .listRooms(a, { workspaceId: w.workspace.workspaceId })
        .some((x) => x.roomId === r.roomId),
      true,
    );
    assert.deepEqual(
      k.sync(a, { roomId: r.roomId, consumerId: "test" }).events,
      before.events,
    );
    k.createTask(a, {
      roomId: r.roomId,
      title: "Preserve active work",
      idempotencyKey: "task",
    });
    const policyHead = head();
    assert.throws(
      () =>
        k.updateSystemChannelVisibility(a, {
          ...command,
          basedOnRoomSeq: policyHead,
          idempotencyKey: "busy-hide",
        }),
      /active collaboration work/i,
    );
    assert.equal(head(), policyHead);
    assert.equal(
      k.getSystemChannelVisibility(a, { workspaceId: w.workspace.workspaceId })
        .hidden,
      false,
    );
  } finally {
    k.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
