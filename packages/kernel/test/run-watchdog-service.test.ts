import { bindRoleDefinitionFixture } from "./role-definition-fixture.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { RoomKernel } from "../src/index.ts";

/**
 * evo §37 B/C: the Kernel owns the live wake-guard and watchdog thresholds
 * (pushed by the daemon settings owner) and the Host-facing watchdog reads.
 */

const MINUTE = 60_000;

test("run guards start at the owner's defaults and merge validated partial updates", () => {
  const state = fixture();
  try {
    assert.deepEqual(state.kernel.runGuards.wakeGuard(), {
      instanceChainLimit: 10,
    });
    assert.deepEqual(state.kernel.runGuards.watchdog(), {
      maxRunMs: 240 * MINUTE,
      noProgressWarnMs: 15 * MINUTE,
      queuedStallTerminateMs: 15 * MINUTE,
    });
    assert.throws(() =>
      state.kernel.runGuards.update({ watchdog: { maxRunMs: 10 } }),
    );
    assert.throws(() =>
      state.kernel.runGuards.update({
        wakeGuard: { instanceChainLimit: 0 },
        watchdog: { noProgressWarnMs: 20 * MINUTE },
      }),
    );
    assert.equal(
      state.kernel.runGuards.watchdog().noProgressWarnMs,
      15 * MINUTE,
      "a rejected update changes nothing",
    );
    state.kernel.runGuards.update({
      watchdog: { noProgressWarnMs: 5 * MINUTE },
    });
    assert.deepEqual(state.kernel.runGuards.watchdog(), {
      maxRunMs: 240 * MINUTE,
      noProgressWarnMs: 5 * MINUTE,
      queuedStallTerminateMs: 15 * MINUTE,
    });
  } finally {
    state.close();
  }
});

test("a Host reads its run's watchdog context: live thresholds and whether other work for the instance is queued", () => {
  const state = fixture();
  try {
    state.mention("first");
    const activation = state.kernel.leaseNextActivation(state.host, {
      leaseMs: 30_000,
    });
    assert.ok(activation);
    assert.deepEqual(
      state.kernel.runWatchdog.read(state.host, {
        activationId: activation.activationId,
      }),
      {
        maxRunMs: 240 * MINUTE,
        noProgressWarnMs: 15 * MINUTE,
        queuedStallTerminateMs: 15 * MINUTE,
        queuedWorkWaiting: false,
      },
    );
    state.mention("second");
    state.kernel.runGuards.update({
      watchdog: { queuedStallTerminateMs: 5 * MINUTE },
    });
    const context = state.kernel.runWatchdog.read(state.host, {
      activationId: activation.activationId,
    });
    assert.equal(context.queuedWorkWaiting, true);
    assert.equal(context.queuedStallTerminateMs, 5 * MINUTE, "no restart");

    const stranger = state.kernel.authenticateHostAccessToken(
      state.kernel.provisionHostCredential({
        hostId: "stranger-host",
        participantIds: [state.otherAgentId],
      }).accessToken,
    );
    assert.throws(
      () =>
        state.kernel.runWatchdog.read(stranger, {
          activationId: activation.activationId,
        }),
      "a Host reads only its own participants' runs",
    );
  } finally {
    state.close();
  }
});

test("the no-progress warning is one idempotent activity fact per RunAttempt and changes nothing else", () => {
  const state = fixture();
  try {
    state.mention("first");
    const activation = state.kernel.leaseNextActivation(state.host, {
      leaseMs: 30_000,
    });
    assert.ok(activation);
    const run = state.kernel.createRunAttempt(state.host, {
      activationId: activation.activationId,
    });
    for (let repeat = 0; repeat < 2; repeat += 1)
      state.kernel.runWatchdog.recordWarning(state.host, {
        runAttemptId: run.runAttemptId,
        thresholdMs: 15 * MINUTE,
      });
    const warnings = state.sql(
      "SELECT payload_json FROM room_events WHERE type = 'run.watchdog_warning'",
    );
    assert.equal(warnings.length, 1);
    assert.deepEqual(JSON.parse(String(warnings[0]!.payload_json)), {
      activationId: activation.activationId,
      hostId: "watchdog-host",
      kind: "no_progress",
      participantId: state.agentId,
      runAttemptId: run.runAttemptId,
      thresholdMs: 15 * MINUTE,
    });
    assert.deepEqual(
      state.sql(
        "SELECT a.state AS activation, r.state AS run FROM activations a JOIN run_attempts r USING (activation_id)",
      ),
      [{ activation: "leased", run: "starting" }],
    );
    const activity = state.kernel.listAgentActivity(state.humanActor, {
      agentId: state.agentDefinitionId,
    });
    assert.equal(
      activity.activities.find(
        (entry) =>
          "eventType" in entry && entry.eventType === "run.watchdog_warning",
      )?.tone,
      "warning",
      "visible as a warning in the instance activity",
    );
  } finally {
    state.close();
  }
});

const digest = (value: string) => `sha256:${value.repeat(64)}`;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "loom-run-watchdog-service-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "owner", kind: "human" });
  const agent = kernel.provisionPrincipal({ handle: "agent", kind: "agent" });
  const other = kernel.provisionPrincipal({ handle: "other", kind: "agent" });
  const humanActor = kernel.authenticateAccessToken(human.accessToken);
  const agentId = agent.principal.principalId;
  const workspace = kernel.createWorkspace(humanActor, {
    idempotencyKey: "watchdog-workspace",
    name: "Watchdog Workspace",
    slug: "watchdog-workspace",
  });
  const controlRoomId = workspace.controlRoom.roomId;
  const room = kernel.createWorkspaceRoom(humanActor, {
    basedOnControlRoomSeq: workspace.event.roomSeq,
    idempotencyKey: "watchdog-room",
    kind: "channel",
    name: "Watchdog",
    slug: "watchdog",
    workspaceId: workspace.workspace.workspaceId,
  }).room;
  for (const roomId of [controlRoomId, room.roomId])
    kernel.addMember(humanActor, { principalId: agentId, roomId });
  const latestSeq = () =>
    kernel.sync(humanActor, { consumerId: "watchdog", roomId: controlRoomId })
      .latestRoomSeq;
  const policy = kernel.createExecutionPolicy(humanActor, {
    basedOnRoomSeq: latestSeq(),
    controlRoomId,
    idempotencyKey: "watchdog-policy",
    modelIntent: {
      fallback: "disabled",
      reasoning: "default",
      serviceTier: "default",
    },
    preferred: [],
    required: {
      allowedProtocolFamilies: ["rah-worker-process/v1"],
      capabilities: [],
      minimumIsolation: "process",
      workspaceMode: "in_place",
    },
    retryPolicyRef: {
      artifactId: "retry-policy",
      contentDigest: digest("a"),
      versionId: "retry-policy-v1",
    },
    sessionPolicy: "fresh",
  });
  const definition = kernel.createAgentDefinition(humanActor, {
    basedOnRoomSeq: latestSeq(),
    controlRoomId,
    executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
    idempotencyKey: "watchdog-agent-definition",
    instructionRefs: [],
    memoryPolicyRef: {
      artifactId: "memory-policy",
      contentDigest: digest("b"),
      versionId: "memory-policy-v1",
    },
    participantId: agentId,
    role: "worker",
    skillRefs: [],
  });
  bindRoleDefinitionFixture(
    kernel,
    humanActor,
    join(directory, "room.db"),
    definition.definition.agentId,
    room.roomId,
    "fixture-offer",
  );
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "watchdog-host",
      participantIds: [agentId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  let mentions = 0;
  return {
    agentDefinitionId: definition.definition.agentId,
    agentId,
    close: () => {
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
    host,
    humanActor,
    kernel,
    mention: (label: string) => {
      mentions += 1;
      kernel.postMessage(humanActor, {
        body: `@agent ${label}`,
        idempotencyKey: `mention-${String(mentions)}`,
        recipients: [{ participantId: agentId, reason: "mention" }],
        roomId: room.roomId,
      });
    },
    otherAgentId: other.principal.principalId,
    sql: (query: string) => {
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        return database
          .prepare(query)
          .all()
          .map((row) => ({ ...row }));
      } finally {
        database.close();
      }
    },
  };
}
