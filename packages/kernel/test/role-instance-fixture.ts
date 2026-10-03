import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RoomKernel } from "../src/index.ts";
import { agentRuntimeContextFromPlacement } from "../src/run-agent-context.ts";

// S1-f/S3: Role instance isolation and lifecycle invariants. Fake Host, no
// provider process; every assertion reads durable Kernel state.
export function roleInstanceFixture(options: { now?: () => Date } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "rah-role-lifecycle-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({
    databasePath,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  kernel.initialize();
  const owner = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const actor = kernel.authenticateAccessToken(owner.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    name: "Roles",
    slug: "roles",
    idempotencyKey: "workspace",
  });
  const db = new DatabaseSync(databasePath);
  const head = (id: string) =>
    Number(
      db
        .prepare("SELECT next_seq - 1 AS seq FROM rooms WHERE room_id=?")
        .get(id)!.seq,
    );
  const controlRoomId = workspace.controlRoom.roomId;
  const role = kernel.roles.create(actor, {
    controlRoomId,
    basedOnRoomSeq: head(controlRoomId),
    idempotencyKey: "role",
    configuration: {
      displayName: "Reviewer",
      handle: "reviewer",
      instructions: "Review only.",
      role: "Review",
      runtimeOfferId: "offer",
      modelIntent: { fallback: "disabled" as const },
    },
  }).role;
  const channel = (slug: string) =>
    kernel.createWorkspaceRoom(actor, {
      workspaceId: workspace.workspace.workspaceId,
      basedOnControlRoomSeq: head(controlRoomId),
      kind: "channel",
      idempotencyKey: slug,
      name: slug,
      slug,
    }).room;
  const home = channel("home");
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "host",
      participantIds: [
        kernel.provisionPrincipal({ handle: "bootstrap", kind: "agent" })
          .principal.principalId,
      ],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const now = options.now?.() ?? new Date(),
    digest = `sha256:${"a".repeat(64)}`;
  kernel.publishRuntimeOffer(host, {
    hostId: host.hostId,
    hostInstanceId: host.instanceId,
    runtimeOfferId: "offer",
    runtimeProfileId: "profile",
    runtimeProfileRevisionId: "profile-v1",
    revisionDigest: digest,
    protocolFamily: "rah-worker-process/v1",
    state: "available",
    observedAt: now.toISOString(),
    leaseUntil: new Date(now.getTime() + 600_000).toISOString(),
    isolation: { evidence: "declared", level: "none" },
    maxConcurrent: 2,
    capacityPoolIds: [],
    capabilityEvidence: [],
    certificationRefs: [],
    modelBindingDescriptors: [],
    supportedToolAccessModes: ["full_access"],
    workspaceMountDescriptors: [
      {
        workspaceDefinitionId: workspace.workspace.workspaceId,
        workspaceMountRevisionId: "mount",
        workspaceMountDigest: digest,
        modes: ["in_place"],
      },
    ],
  });
  const created = kernel.roles.instantiate(actor, {
    roleId: role.roleId,
    channelId: home.roomId,
    basedOnRoomSeq: head(home.roomId),
    idempotencyKey: "instance",
  });
  const instance = created.instance;
  const privateBox = kernel.openDirectRoom(actor, {
    workspaceId: workspace.workspace.workspaceId,
    peerPrincipalId: instance.instanceId,
    basedOnControlRoomSeq: head(controlRoomId),
    idempotencyKey: "instance-dm",
  });
  const revisionId = created.agent.currentRevision.agentDefinitionRevisionId;
  /** Simulates a completed removal without draining unrelated work. */
  const detachFromChannel = () =>
    db
      .prepare("DELETE FROM memberships WHERE room_id=? AND principal_id=?")
      .run(home.roomId, instance.instanceId);
  const close = () => {
    db.close();
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  };
  return {
    actor,
    agentId: created.agent.definition.agentId,
    channel,
    close,
    controlRoomId,
    db,
    detachFromChannel,
    head,
    home,
    host,
    instance,
    kernel,
    owner,
    privateBox,
    revisionId,
    role,
    workspace,
  };
}

export type RoleInstanceFixture = ReturnType<typeof roleInstanceFixture>;

export function startInstanceRun(f: RoleInstanceFixture) {
  f.kernel.postMessage(f.actor, {
    roomId: f.home.roomId,
    body: "please review",
    idempotencyKey: `wake-${String(Math.random())}`,
    recipients: [{ participantId: f.instance.instanceId, reason: "mention" }],
  });
  return startInstanceRunFromQueue(f);
}

/** Leases the next queued Activation and starts a fake run for it. */
export function startInstanceRunFromQueue(f: RoleInstanceFixture) {
  const activation = f.kernel.leaseNextActivation(f.host, {
    leaseMs: 600_000,
  });
  assert.ok(activation);
  assert.equal(activation.participantId, f.instance.instanceId);
  const run = f.kernel.createRunAttempt(f.host, {
    activationId: activation.activationId,
  });
  return runFakeAttempt(f, activation, run.runAttemptId);
}

/**
 * Reserves and claims the next Placement the way the Host does, so the
 * launch-time agent context of that exact Activation is observable.
 */
export function claimInstanceRun(f: RoleInstanceFixture) {
  const placement = f.kernel.scheduleNextPlacement({ leaseMs: 600_000 });
  assert.ok(placement);
  const claim = f.kernel.claimNextPlacement(f.host, { leaseMs: 600_000 });
  assert.ok(claim);
  assert.equal(claim.activation.participantId, f.instance.instanceId);
  return {
    ...runFakeAttempt(f, claim.activation, claim.runAttempt.runAttemptId),
    agentContext: claim.agentContext,
  };
}

function runFakeAttempt(
  f: RoleInstanceFixture,
  activation: {
    activationId: string;
    participantId: string;
    roomId: string;
    toSeq: number;
  },
  runAttemptId: string,
) {
  const run = { runAttemptId };
  const runtime = {
    runAttemptId,
    runtimeRunId: "fake-" + runAttemptId,
    recoveryDescriptor: {
      driver: "fake",
      recoveryKey: runAttemptId,
      metadata: {},
    },
  };
  f.kernel.prepareRunAttemptRuntime(f.host, runtime);
  f.kernel.markRunAttemptRunning(f.host, runtime);
  const scope = {
    activationId: activation.activationId,
    consumerId: "worker",
    hostId: f.host.hostId,
    participantId: activation.participantId,
    roomId: activation.roomId,
    runAttemptId,
    toSeq: activation.toSeq,
  };
  const execution = f.kernel.authorizeWorkerExecution(f.host, scope);
  const finish = (exitCode: number) => {
    f.kernel.acknowledgeWorkerCursor(execution, {
      throughSeq: activation.toSeq,
    });
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId,
      runtimeRunId: runtime.runtimeRunId,
      exit: { code: exitCode },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId,
      state: exitCode === 0 ? "exited" : "failed",
      exitCode,
    });
    f.kernel.completeActivation(f.host, {
      activationId: activation.activationId,
      consumerId: "worker",
    });
  };
  return { activation, run, runtime, scope, execution, finish };
}

export const launchContext = (f: RoleInstanceFixture) =>
  agentRuntimeContextFromPlacement(f.db, {
    participant_id: f.instance.instanceId,
    agent_definition_revision_id: f.revisionId,
  });
