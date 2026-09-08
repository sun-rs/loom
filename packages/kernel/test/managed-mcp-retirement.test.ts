import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RoomKernel } from "../src/index.ts";
import { assertNoActiveRoomWork } from "../src/room-lifecycle-policy.ts";
const digest = (value: string) => `sha256:${value.repeat(64)}`;
const latestRoomSeq = (
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
) => kernel.sync(actor, { roomId, consumerId: "retired-mcp" }).latestRoomSeq;
function fixture(state: "failed" | "pending") {
  const directory = mkdtempSync(join(tmpdir(), "rah-retired-mcp-"));
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const human = kernel.provisionPrincipal({
    handle: "managed-mcp-human",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "managed-mcp-agent",
    kind: "agent",
  });
  const outsider = kernel.provisionPrincipal({
    handle: "managed-mcp-outsider",
    kind: "human",
  });
  const humanActor = kernel.authenticateAccessToken(human.accessToken);
  const outsiderActor = kernel.authenticateAccessToken(outsider.accessToken);
  const workspace = kernel.createWorkspace(humanActor, {
    idempotencyKey: "managed-mcp-workspace",
    name: "Managed MCP Workspace",
    slug: "managed-mcp-workspace",
  });
  const controlRoomId = workspace.controlRoom.roomId;
  const workRoom = kernel.createWorkspaceRoom(humanActor, {
    basedOnControlRoomSeq: workspace.event.roomSeq,
    idempotencyKey: "managed-mcp-work-room",
    kind: "channel",
    name: "Managed MCP Work",
    slug: "managed-mcp-work",
    workspaceId: workspace.workspace.workspaceId,
  }).room;
  for (const roomId of [controlRoomId, workRoom.roomId]) {
    kernel.addMember(humanActor, {
      principalId: agent.principal.principalId,
      roomId,
    });
  }
  const policy = kernel.createExecutionPolicy(humanActor, {
    basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
    controlRoomId,
    idempotencyKey: "managed-mcp-policy",
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
  const agentDefinition = kernel.createAgentDefinition(humanActor, {
    basedOnRoomSeq: latestRoomSeq(kernel, humanActor, controlRoomId),
    controlRoomId,
    executionPolicyRevisionId: policy.policy.executionPolicyRevisionId,
    idempotencyKey: "managed-mcp-agent-definition",
    instructionRefs: [],
    memoryPolicyRef: {
      artifactId: "memory-policy",
      contentDigest: digest("b"),
      versionId: "memory-policy-v1",
    },
    participantId: agent.principal.principalId,
    role: "tool-using agent",
    skillRefs: [],
  });

  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "retired-host",
      participantIds: [agent.principal.principalId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  kernel.postMessage(humanActor, {
    roomId: workRoom.roomId,
    body: "Historical activity",
    idempotencyKey: "retired-wake",
    recipients: [
      { participantId: agent.principal.principalId, reason: "mention" },
    ],
  });
  const activation = kernel.leaseNextActivation(host, { leaseMs: 30000 })!;
  const run = kernel.createRunAttempt(host, {
    activationId: activation.activationId,
  });
  const runtime = {
    runAttemptId: run.runAttemptId,
    runtimeRunId: "retired-runtime",
    recoveryDescriptor: {
      driver: "fake-runtime",
      recoveryKey: "retired-runtime",
      metadata: {},
    },
  };
  kernel.prepareRunAttemptRuntime(host, runtime);
  kernel.markRunAttemptRunning(host, runtime);
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys=ON");
  const stamp = new Date().toISOString();
  // Exact historical SQLite shape, injected as an old persistent record. There
  // is intentionally no current managed MCP mutation API to construct it.
  db.prepare(
    "INSERT INTO managed_mcp_servers VALUES ('retired-server', ?, 1, 'retired-revision', 'disabled', ?, ?)",
  ).run(controlRoomId, stamp, stamp);
  db.prepare(
    "INSERT INTO managed_mcp_server_revisions VALUES ('retired-revision', 'retired-server', 1, ?, ?, ?, ?)",
  ).run(
    digest("a"),
    JSON.stringify({ serverName: "Retired server" }),
    human.principal.principalId,
    stamp,
  );
  db.prepare(
    "INSERT INTO managed_mcp_calls VALUES ('retired-call', ?, ?, ?, 'retired-server', 'old-tool', 1, 1, ?, ?, NULL, NULL, ?, ?, ?, ?)",
  ).run(
    run.runAttemptId,
    agent.principal.principalId,
    workRoom.roomId,
    digest("b"),
    state,
    state === "failed" ? "authorization_lost_after_execution" : null,
    stamp,
    stamp,
    state === "failed" ? stamp : null,
  );
  return {
    kernel,
    db,
    databasePath,
    host,
    activation,
    run,
    agent,
    humanActor,
    outsiderActor,
    controlRoomId,
    workRoom,
    agentDefinition,
    close() {
      db.close();
      kernel.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("retired MCP failure receipts remain readable across reopen without a mutation owner", () => {
  const f = fixture("failed");
  try {
    const before = f.db.prepare("SELECT * FROM managed_mcp_calls").all();
    f.kernel.initialize();
    const reopened = new RoomKernel({ databasePath: f.databasePath });
    try {
      reopened.initialize();
      const actor = f.humanActor;
      const page = reopened.listAgentActivity(actor, {
        agentDefinitionId: f.agentDefinition.definition.agentDefinitionId,
        limit: 100,
      });
      const entry = page.activities.find(
        (row) => row.source === "managed_mcp_call",
      );
      assert.equal(entry?.failureCode, "authorization_lost_after_execution");
      assert.equal(entry?.state, "failed");
      assert.equal("managedMcp" in reopened, false);
      assert.throws(() =>
        reopened.listAgentActivity(f.outsiderActor, {
          agentDefinitionId: f.agentDefinition.definition.agentDefinitionId,
        }),
      );
      assert.deepEqual(
        f.db.prepare("SELECT * FROM managed_mcp_calls").all(),
        before,
      );
    } finally {
      reopened.close();
    }
  } finally {
    f.close();
  }
});
test("retired pending MCP receipt cannot strand a Room but a real active Run still blocks lifecycle", () => {
  const f = fixture("pending");
  try {
    assert.throws(() => assertNoActiveRoomWork(f.db, f.workRoom.roomId));
    const actor = f.kernel.authenticateAccessToken(f.agent.accessToken);
    const delivery = f.kernel.sync(actor, {
      roomId: f.workRoom.roomId,
      consumerId: "retired-consumer",
    });
    f.kernel.acknowledgeCursor(actor, {
      roomId: f.workRoom.roomId,
      consumerId: "retired-consumer",
      throughSeq: delivery.cursorAfter,
    });
    f.kernel.recordRuntimeTermination(f.host, {
      runAttemptId: f.run.runAttemptId,
      runtimeRunId: "retired-runtime",
      exit: { code: 0 },
    });
    f.kernel.finishRunAttempt(f.host, {
      runAttemptId: f.run.runAttemptId,
      state: "exited",
      exitCode: 0,
    });
    f.kernel.completeActivation(f.host, {
      activationId: f.activation.activationId,
      consumerId: "retired-consumer",
    });
    assert.doesNotThrow(() => assertNoActiveRoomWork(f.db, f.workRoom.roomId));
    assert.equal(
      f.db.prepare("SELECT state FROM managed_mcp_calls").get()?.state,
      "pending",
      "retirement does not invent external success/failure",
    );
  } finally {
    f.close();
  }
});
