import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";
import { issueAuthenticatedWorkerExecutionContext } from "../src/auth.ts";
import { WorkerSelfProfileService } from "../src/worker-self-profile.ts";
import { ProfileImageLifecycleService } from "../src/profile-image-lifecycle.ts";
import { RoomEventWriter } from "../src/room-event-writer.ts";
import { ActivationObligationService } from "../src/activation-obligation-service.ts";
import { inImmediateTransaction } from "../src/sqlite-transaction.ts";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rah-worker-profile-")),
    path = join(dir, "room.db"),
    now = () => new Date("2026-09-08T00:00:00Z");
  const kernel = new RoomKernel({ databasePath: path, now });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" }),
    agent = kernel.provisionPrincipal({ handle: "alice", kind: "agent" });
  const actor = kernel.authenticateAccessToken(human.accessToken),
    agentActor = kernel.authenticateAccessToken(agent.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    name: "Profiles",
    slug: "profiles",
    idempotencyKey: "workspace",
  });
  const control = workspace.controlRoom.roomId;
  kernel.addMember(actor, {
    roomId: control,
    principalId: agent.principal.principalId,
  });
  const room = kernel.createWorkspaceRoom(actor, {
    workspaceId: workspace.workspace.workspaceId,
    kind: "channel",
    name: "Work",
    slug: "work",
    visibility: "public",
    basedOnControlRoomSeq: kernel.sync(actor, {
      roomId: control,
      consumerId: "head",
    }).latestRoomSeq,
    idempotencyKey: "room",
  });
  kernel.addMember(actor, {
    roomId: room.room.roomId,
    principalId: agent.principal.principalId,
  });
  const db = new DatabaseSync(path),
    head = () =>
      Number(
        db
          .prepare("SELECT next_seq-1 AS n FROM rooms WHERE room_id=?")
          .get(control)!.n,
      );
  const ref = {
    artifactId: "private-memory",
    versionId: "v1",
    contentDigest: `sha256:${"a".repeat(64)}`,
  };
  const policy = kernel.createExecutionPolicy(actor, {
    controlRoomId: control,
    basedOnRoomSeq: head(),
    idempotencyKey: "policy",
    modelIntent: { fallback: "disabled" },
    preferred: [],
    required: {
      allowedOfferIds: ["offer"],
      allowedProtocolFamilies: ["rah-worker-process/v1"],
      capabilities: [],
      minimumIsolation: "none",
      workspaceMode: "in_place",
    },
    retryPolicyRef: ref,
    sessionPolicy: "fresh",
    toolAccessMode: "full_access",
  });
  const definition = kernel.createAgentDefinition(actor, {
    controlRoomId: control,
    basedOnRoomSeq: head(),
    idempotencyKey: "definition",
    participantId: agent.principal.principalId,
    executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
    role: "PRIVATE ROLE",
    instructions: "PRIVATE INSTRUCTIONS",
    displayName: "Alice",
    instructionRefs: [],
    skillRefs: [],
    memoryPolicyRef: ref,
  });
  const execution = issueAuthenticatedWorkerExecutionContext(
    "credential",
    "instance",
    {
      activationId: "activation",
      consumerId: "consumer",
      hostId: "host",
      participantId: agent.principal.principalId,
      roomId: room.room.roomId,
      runAttemptId: "run",
      toSeq: 2,
    },
  );
  let active = true;
  const createId = (prefix: string) => `${prefix}_${randomUUID()}`;
  const events = new RoomEventWriter({
    database: db,
    createId,
    now,
    obligations: new ActivationObligationService({ database: db, createId }),
  });
  const profiles = new WorkerSelfProfileService({
    database: db,
    createId,
    now,
    events,
    profileImages: new ProfileImageLifecycleService({
      database: db,
      now,
      createId,
      requireActor: (candidate) =>
        kernel.getAuthenticatedPrincipal(candidate).principalId,
    }),
    requireWorker: (candidate) => {
      if (!active || candidate !== execution)
        throw new Error("execution fenced");
      return candidate.scope;
    },
    transaction: (operation) => inImmediateTransaction(db, operation),
  });
  return {
    kernel,
    db,
    profiles,
    execution,
    definition,
    actor,
    agentActor,
    agent,
    control,
    head,
    roomId: room.room.roomId,
    revoke() {
      active = false;
    },
    close() {
      db.close();
      kernel.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("self profile metadata uses one current revision and control event without changing work Room or private identity", () => {
  const f = fixture();
  try {
    const read = f.profiles.get(f.execution, {});
    assert.equal(read.profile.displayName, "Alice");
    assert.equal(read.writeContext.controlRoomSeq, f.head());
    assert.ok(!JSON.stringify(read).includes("PRIVATE"));
    assert.ok(!JSON.stringify(read).includes("private-memory"));
    const beforeWork = f.db
      .prepare("SELECT next_seq FROM rooms WHERE room_id=?")
      .get(f.roomId)!.next_seq;
    const command = {
      writeContext: read.writeContext,
      idempotencyKey: "self-edit",
      patch: { displayName: "Alicia", description: "Visible description" },
    };
    const changed = f.profiles.update(f.execution, command);
    assert.equal(changed.profile.displayName, "Alicia");
    assert.equal(changed.profile.description, "Visible description");
    assert.equal(
      changed.writeContext.controlRoomSeq,
      read.writeContext.controlRoomSeq + 1,
    );
    assert.equal(
      f.db.prepare("SELECT next_seq FROM rooms WHERE room_id=?").get(f.roomId)!
        .next_seq,
      beforeWork,
    );
    const current = f.kernel.getWorkspaceAgentManagementView(
      f.actor,
      f.definition.definition.agentDefinitionId,
    ).agent.currentRevision;
    assert.equal(current.revision, 2);
    assert.equal(current.role, f.definition.revision.role);
    assert.deepEqual(
      current.memoryPolicyRef,
      f.definition.revision.memoryPolicyRef,
    );
    assert.equal(
      current.executionPolicyRevisionId,
      f.definition.revision.executionPolicyRevisionId,
    );
    assert.equal(f.profiles.update(f.execution, command).deduplicated, true);
    assert.throws(
      () =>
        f.profiles.update(f.execution, {
          ...command,
          patch: { displayName: "Changed" },
        }),
      /idempotency/i,
    );
    assert.throws(
      () =>
        f.profiles.update(f.execution, { ...command, idempotencyKey: "stale" }),
      /stale|revision/i,
    );
    assert.throws(
      () =>
        f.profiles.update(f.execution, {
          ...command,
          idempotencyKey: "wrong-room",
          writeContext: { ...changed.writeContext, controlRoomId: f.roomId },
        }),
      /control|scope/i,
    );
    f.revoke();
    assert.throws(() => f.profiles.get(f.execution, {}), /fenced/);
    assert.throws(() => f.profiles.update(f.execution, command), /fenced/);
  } finally {
    f.close();
  }
});
test("self update fails closed after Human CAS conflict or membership removal", () => {
  const f = fixture();
  try {
    const read = f.profiles.get(f.execution, {});
    f.kernel.manageWorkspaceAgent(f.actor, {
      action: "update_profile",
      agentDefinitionId: f.definition.definition.agentDefinitionId,
      expectedRevisionId: read.writeContext.expectedRevisionId,
      basedOnRoomSeq: read.writeContext.controlRoomSeq,
      idempotencyKey: "human",
      field: "description",
      value: "Human chose this",
    });
    assert.throws(
      () =>
        f.profiles.update(f.execution, {
          writeContext: read.writeContext,
          idempotencyKey: "late-worker",
          patch: { description: "Overwrite" },
        }),
      /stale|revision/i,
    );
    const fresh = f.profiles.get(f.execution, {});
    f.db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(f.roomId, f.agent.principal.principalId);
    assert.throws(
      () =>
        f.profiles.update(f.execution, {
          writeContext: fresh.writeContext,
          idempotencyKey: "removed",
          patch: { description: "Unauthorized" },
        }),
      /enabled Agent member/,
    );
  } finally {
    f.close();
  }
});

test("Worker avatar binding requires its own intent, keeps rollback atomic, and rejects another public profile image", () => {
  const f = fixture();
  try {
    const key = `upload_png_${"a".repeat(40)}`;
    const other = f.kernel.profileImages.recordUpload(f.actor, {
      avatarKey: key,
    });
    f.kernel.updateAuthenticatedPrincipal(f.actor, {
      displayName: "Human",
      avatarKey: key,
      avatarUploadIntentId: other.uploadIntentId,
    });
    const before = f.profiles.get(f.execution, {});
    assert.throws(
      () =>
        f.profiles.update(f.execution, {
          writeContext: before.writeContext,
          idempotencyKey: "steal-public",
          patch: { avatarKey: key },
        }),
      /own completed upload intent/,
    );
    assert.throws(
      () =>
        f.profiles.update(f.execution, {
          writeContext: before.writeContext,
          idempotencyKey: "steal-intent",
          patch: { avatarKey: key, avatarUploadIntentId: other.uploadIntentId },
        }),
      /own completed upload intent/,
    );
    const own = f.profiles.recordAvatarUpload(f.execution, { avatarKey: key });
    f.db.exec(
      "CREATE TRIGGER reject_self_avatar BEFORE INSERT ON room_events WHEN NEW.idempotency_key='atomic-avatar' BEGIN SELECT RAISE(ABORT,'atomic avatar failure'); END;",
    );
    const command = {
      writeContext: before.writeContext,
      idempotencyKey: "atomic-avatar",
      patch: { avatarKey: key, avatarUploadIntentId: own.uploadIntentId },
    };
    assert.throws(
      () => f.profiles.update(f.execution, command),
      /atomic avatar failure/,
    );
    assert.ok(
      f.db
        .prepare(
          "SELECT 1 FROM profile_image_upload_intents WHERE upload_intent_id=?",
        )
        .get(own.uploadIntentId),
    );
    assert.deepEqual(f.profiles.get(f.execution, {}), before);
    f.db.exec("DROP TRIGGER reject_self_avatar");
    const result = f.profiles.update(f.execution, command);
    assert.equal(result.profile.avatarKey, key);
    assert.equal(
      f.db
        .prepare(
          "SELECT 1 FROM profile_image_upload_intents WHERE upload_intent_id=?",
        )
        .get(own.uploadIntentId),
      undefined,
    );
    assert.equal(f.profiles.update(f.execution, command).deduplicated, true);
    assert.equal(
      f.profiles.update(f.execution, {
        writeContext: result.writeContext,
        idempotencyKey: "same-self-avatar",
        patch: { avatarKey: key },
      }).profile.avatarKey,
      key,
    );
  } finally {
    f.close();
  }
});
