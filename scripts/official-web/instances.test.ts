import assert from "node:assert/strict";
import test from "node:test";
import { RoomSession } from "@rah-os/client-core";
import { FakeRahClient } from "@rah-os/client-sdk";
import { LoomInstanceClient } from "../../frontends/raft/loom/instances.ts";

test("adding an instance freezes Role, Channel, key and causal basis through unknown-result verification", async () => {
  const calls: any[] = [];
  const client = new FakeRahClient(async (op, input) => {
    if (op === "room.sync")
      return {
        cursorBefore: 3,
        cursorAfter: 3,
        latestRoomSeq: 3,
        eventFloorSeq: 3,
        snapshotSeq: 3,
        events: [],
        snapshot: {
          room: {
            roomId: "control",
            workspaceId: "workspace",
            name: "Control",
            slug: "control",
            kind: "channel",
            createdAt: "2026-10-14T00:00:00Z",
          },
          members: [],
        },
      };
    if (op === "room.acknowledge") return { acknowledgedThrough: 3 };
    if (op === "role.instantiate") {
      calls.push(input);
      if (calls.length === 1) throw new Error("lost response");
      const now = "2026-10-14T00:00:00Z";
      return {
        instance: {
          instanceId: "new-instance",
          agentId: "agent",
          roleId: "a",
          roleRevisionId: "role-rev",
          channelId: "control",
        },
        agent: {
          handle: "Tom-1",
          definition: {
            agentId: "agent",
            participantId: "new-instance",
            controlRoomId: "control",
            state: "enabled",
            currentRevisionId: "rev",
            createdAt: now,
            updatedAt: now,
          },
          currentRevision: {
            agentDefinitionRevisionId: "rev",
            agentId: "agent",
            revision: 1,
            role: "test",
            instructionRefs: [],
            skillRefs: [],
            memoryPolicyRef: {
              artifactId: "artifact",
              versionId: "version",
              contentDigest: "sha256:" + "a".repeat(64),
            },
            executionPolicyRevisionId: "policy",
            contentDigest: "sha256:" + "b".repeat(64),
            createdBy: "human",
            createdAt: now,
          },
        },
        event: {
          eventId: "event",
          roomId: "control",
          roomSeq: 4,
          type: "instance.created",
          actorId: "human",
          aggregateType: "instance",
          aggregateId: "new-instance",
          payload: {},
          idempotencyKey: input.idempotencyKey,
          schemaVersion: 1,
          createdAt: now,
        },
        deduplicated: true,
      };
    }
    throw new Error(op);
  });
  const boxes = new LoomInstanceClient(
    client,
    new RoomSession({ client, roomId: "control", consumerId: "consumer" }),
  );
  const first = await boxes.add("a");
  assert.equal(
    first.kind,
    "unknown",
    first.kind === "rejected" ? String(first.error) : undefined,
  );
  assert.equal((await boxes.add("b")).kind, "busy");
  assert.equal(calls.length, 1);
  assert.equal((await boxes.writes.retry()).kind, "ok");
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].roleId, "a");
  assert.equal(calls[0].channelId, "control");
  assert.equal(calls[0].basedOnRoomSeq, 3);
  boxes.writes.discard();
});
