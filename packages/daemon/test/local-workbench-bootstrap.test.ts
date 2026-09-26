import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  buildRuntimeOfferFromProfile,
  DEFAULT_WARM_RUNTIME_POLICY,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import { ProviderSessionStore } from "../../agent-host/src/provider-session-store.ts";
import { RoomKernel } from "@rah-os/kernel";

import {
  prepareLocalWorkbench,
  type LocalWorkbenchRuntimeSpec,
} from "../src/local-workbench-bootstrap.ts";
import { compileStandingPrompt } from "../src/standing-prompt-compiler.ts";

test("local workbench bootstrap is persistent, owner-private, and restart-safe", async () => {
  const parent = mkdtempSync(join(tmpdir(), "rah-local-workbench-"));
  const stateDirectory = join(parent, "state");
  const workspaceCwd = join(parent, "workspace");
  mkdirSync(workspaceCwd);
  const spec = fakeRuntimeSpec(workspaceCwd);
  try {
    const first = await prepareLocalWorkbench({
      runtimeSpecs: [spec],
      stateDirectory,
      workspaceCwd,
    });
    assert.equal(statSync(stateDirectory).mode & 0o777, 0o700);
    assert.equal(statSync(first.humanSecretPath).mode & 0o777, 0o600);
    assert.equal(statSync(first.hostSecretPath).mode & 0o777, 0o600);
    assert.equal(first.config.workspace.cwd, workspaceCwd);
    assert.equal(first.config.startupProbeMode, "reuse-latest");
    assert.equal(
      first.config.pollIntervalMs,
      30_000,
      "idle AgentHost reconciliation should use the Multica-style coarse fallback because durable Outbox wake owns interactive latency",
    );
    assert.equal(
      first.config.outboxPollIntervalMs,
      250,
      "the local durable wake bridge should stay responsive without scanning SQLite ten times per second",
    );
    assert.deepEqual(first.config.host.participantIds, [
      first.metadata.bootstrapParticipantIds[0],
    ]);
    const initializedRegistry = new RuntimeProfileRegistry({
      databasePath: first.registryDatabasePath,
      hostId: first.metadata.hostId,
    });
    initializedRegistry.initialize();
    assert.equal(
      initializedRegistry
        .listAuditEntries(spec.runtimeProfileId)
        .filter(({ action }) => action === "probe_recorded").length,
      1,
      "first bootstrap must not probe the same runtime twice",
    );
    initializedRegistry.close();

    const kernel = new RoomKernel({
      databasePath: join(stateDirectory, "room.db"),
    });
    kernel.initialize();
    const human = kernel.authenticateHumanAccessToken(first.humanAccessToken);
    assert.equal(kernel.listWorkspaces(human)[0]?.name, hostname());
    kernel.postMessage(human, {
      body: "persistent message",
      idempotencyKey: "restart-proof-message",
      recipients: [],
      roomId: first.metadata.defaultRoomId,
    });
    assert.equal(
      kernel.listAgentCatalog(human, {
        controlRoomId: first.metadata.controlRoomId,
      })[0]?.currentRevision.instructions,
      spec.instructions,
    );
    const catalogEntry = kernel.listAgentCatalog(human, {
      controlRoomId: first.metadata.controlRoomId,
    })[0];
    assert.ok(catalogEntry);
    assert.deepEqual(catalogEntry.currentRevision.executionWorkspace, {
      kind: "agent_private",
    });
    assert.equal(
      kernel.getExecutionPolicyRevision(
        catalogEntry.currentRevision.executionPolicyRevisionId,
      ).toolAccessMode,
      "full_access",
      "bootstrap must freeze the Raft-compatible unattended policy",
    );
    kernel.close();

    const second = await prepareLocalWorkbench({
      runtimeSpecs: [spec],
      stateDirectory,
      workspaceCwd,
    });
    assert.deepEqual(second.metadata, first.metadata);
    assert.equal(second.humanAccessToken, first.humanAccessToken);
    assert.equal(second.hostAccessToken, first.hostAccessToken);

    const reopened = new RoomKernel({
      databasePath: join(stateDirectory, "room.db"),
    });
    reopened.initialize();
    const reopenedHuman = reopened.authenticateHumanAccessToken(
      second.humanAccessToken,
    );
    assert.equal(
      reopened.listMessages(reopenedHuman, {
        roomId: second.metadata.defaultRoomId,
      }).messages[0]?.body,
      "persistent message",
    );
    assert.deepEqual(
      reopened.authenticateHostAccessToken(second.hostAccessToken)
        .participantIds,
      second.metadata.bootstrapParticipantIds,
    );
    reopened.close();

    const registry = new RuntimeProfileRegistry({
      databasePath: second.registryDatabasePath,
      hostId: second.metadata.hostId,
    });
    registry.initialize();
    assert.equal(
      registry.getActiveRevision(spec.runtimeProfileId)?.manifest.adapter
        .executable,
      process.execPath,
    );
    assert.equal(registry.listRevisions(spec.runtimeProfileId).length, 1);
    assert.equal(
      registry
        .listAuditEntries(spec.runtimeProfileId)
        .filter(({ action }) => action === "probe_recorded").length,
      1,
      "an equivalent restart probe must not duplicate immutable evidence",
    );
    assert.equal(
      registry.getProbeValidation(
        registry.getActiveRevision(spec.runtimeProfileId)!
          .runtimeProfileRevisionId,
      )?.validationCount,
      2,
      "a later service start advances the validation head exactly once",
    );
    registry.close();

    await assert.rejects(
      prepareLocalWorkbench({
        runtimeSpecs: [spec],
        stateDirectory,
        workspaceCwd: join(parent, "different-workspace"),
      }),
      /belongs to workspace/u,
    );
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

test("different instances of one CLI share its offer in parallel up to a configurable Host cap", async () => {
  const parent = mkdtempSync(
    join(tmpdir(), "rah-local-workbench-concurrency-"),
  );
  const stateDirectory = join(parent, "state");
  const workspaceCwd = join(parent, "workspace");
  mkdirSync(workspaceCwd);
  const spec = fakeRuntimeSpec(workspaceCwd);
  try {
    const defaults = await prepareLocalWorkbench({
      runtimeSpecs: [spec],
      stateDirectory,
      workspaceCwd,
    });
    // Contract §3: different instances run in parallel. A per-CLI offer of 1
    // serialized every instance of that CLI across Roles and Channels. The
    // offer now advertises the config ceiling; the runtime-adjustable Host and
    // per-CLI caps (daemon concurrency settings) bound scheduling. The Host
    // default follows the warm pool's hard busy-turn cap, so the planner holds
    // excess work durably at the same bound instead of the pool failing it.
    assert.equal(defaults.config.runtimes[0]?.offer.maxConcurrent, 64);
    assert.equal(
      defaults.config.host.maxConcurrent,
      DEFAULT_WARM_RUNTIME_POLICY.maxBusyTurns,
      "the Host cap bounds all lanes, not the number of installed CLIs",
    );

    const configured = await prepareLocalWorkbench({
      maxConcurrentRuns: 3,
      runtimeSpecs: [spec],
      stateDirectory,
      workspaceCwd,
    });
    assert.equal(configured.config.runtimes[0]?.offer.maxConcurrent, 64);
    assert.equal(configured.config.host.maxConcurrent, 3);

    for (const invalid of [0, 1.5, 65]) {
      await assert.rejects(
        prepareLocalWorkbench({
          maxConcurrentRuns: invalid,
          runtimeSpecs: [spec],
          stateDirectory,
          workspaceCwd,
        }),
        /concurrency/u,
      );
    }
  } finally {
    rmSync(parent, { force: true, recursive: true });
  }
});

function fakeRuntimeSpec(workspaceCwd: string): LocalWorkbenchRuntimeSpec {
  return {
    adapterKind: "generic-process/v1",
    agentHandle: "TestAgent",
    avatarKey: "test-agent",
    cliId: "test",
    description: "A persistent fake Agent for bootstrap verification.",
    displayName: "Test Agent",
    executable: process.execPath,
    instructions: "Always prove persistence through canonical Room actions.",
    reasoning: "default",
    role: "Persistent test Agent",
    runtimeProfileId: "local-workbench-profile-test",
    toolAccessMode: "full_access",
    workspaceCwd,
  };
}

test("restart preserves deletion of a bootstrap Agent without restoring its Host scope", async () => {
  const parent = mkdtempSync(join(tmpdir(), "rah-deleted-bootstrap-"));
  const stateDirectory = join(parent, "state");
  const workspaceCwd = join(parent, "workspace");
  mkdirSync(workspaceCwd);
  const spec = fakeRuntimeSpec(workspaceCwd);
  const input = {
    runtimeSpecs: [
      spec,
      {
        ...spec,
        agentHandle: "OtherAgent",
        cliId: "other",
        runtimeProfileId: "local-workbench-profile-other",
      },
    ],
    stateDirectory,
    workspaceCwd,
  };
  try {
    const first = await prepareLocalWorkbench(input);
    const kernel = new RoomKernel({
      databasePath: join(stateDirectory, "room.db"),
    });
    const actor = kernel.authenticateHumanAccessToken(first.humanAccessToken);
    const agent = kernel.listAgentCatalog(actor)[0]!;
    const db = new DatabaseSync(join(stateDirectory, "room.db"), {
      readOnly: true,
    });
    const seq = Number(
      db
        .prepare("SELECT next_seq - 1 AS seq FROM rooms WHERE room_id = ?")
        .get(first.metadata.controlRoomId)!.seq,
    );
    db.close();
    const disabled = kernel.manageWorkspaceAgent(actor, {
      action: "set_state",
      agentId: agent.definition.agentId,
      state: "disabled",
      basedOnRoomSeq: seq,
      idempotencyKey: "disable-bootstrap",
    });
    kernel.manageWorkspaceAgent(actor, {
      action: "set_state",
      agentId: agent.definition.agentId,
      state: "tombstoned",
      basedOnRoomSeq: disabled.event.roomSeq,
      idempotencyKey: "delete-bootstrap",
    });
    kernel.close();
    const second = await prepareLocalWorkbench(input);
    assert.deepEqual(
      second.config.host.participantIds,
      first.metadata.bootstrapParticipantIds.filter(
        (id) => id !== agent.definition.participantId,
      ),
    );
    assert.deepEqual(
      second.metadata.bootstrapParticipantIds,
      first.metadata.bootstrapParticipantIds,
    );
    assert.equal(second.hostAccessToken, first.hostAccessToken);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("a role edit changes the compiled standing prompt digest without minting a RuntimeProfile revision", async () => {
  const parent = mkdtempSync(join(tmpdir(), "rah-memory-prompt-revision-"));
  const workspaceCwd = join(parent, "workspace");
  const stateDirectory = join(parent, "state");
  mkdirSync(workspaceCwd);
  const base = fakeRuntimeSpec(workspaceCwd);
  const spec = (role: string): LocalWorkbenchRuntimeSpec => ({ ...base, role });
  const digestFor = (role: string): string =>
    compileStandingPrompt({
      agent: {
        description: base.description,
        displayName: base.displayName,
        handle: base.agentHandle,
        instructions: base.instructions,
        participantId: "participant-under-test",
        role,
      },
    }).deterministicDigest;
  let registry: RuntimeProfileRegistry | undefined;
  try {
    const old = await prepareLocalWorkbench({
      runtimeSpecs: [spec("Persistent test Agent")],
      stateDirectory,
      workspaceCwd,
    });
    registry = new RuntimeProfileRegistry({
      databasePath: old.registryDatabasePath,
      hostId: old.metadata.hostId,
    });
    registry.initialize();
    const oldRevision = registry.getActiveRevision(base.runtimeProfileId)!;
    assert.deepEqual(
      oldRevision.manifest.adapter.fixedArgs,
      [],
      "the standing prompt is never frozen into a RuntimeProfile revision",
    );
    const sessions = new ProviderSessionStore({
      rootDirectory: join(parent, "provider-sessions"),
    });
    const oldKey = {
      participantId: old.metadata.bootstrapParticipantIds[0]!,
      provider: "codex-app-server/v1" as const,
      runtimeProfileRevisionId: oldRevision.runtimeProfileRevisionId,
      standingPromptDigest: digestFor("Persistent test Agent"),
      workspaceMountRevisionId: "workspace-test-v1",
    };
    await sessions.record(oldKey, "old-session-with-old-prompt");
    registry.close();
    registry = undefined;

    const current = await prepareLocalWorkbench({
      runtimeSpecs: [spec("Edited persistent test Agent")],
      stateDirectory,
      workspaceCwd,
    });
    assert.deepEqual(current.metadata, old.metadata);
    registry = new RuntimeProfileRegistry({
      databasePath: current.registryDatabasePath,
      hostId: current.metadata.hostId,
    });
    registry.initialize();
    const active = registry.getActiveRevision(base.runtimeProfileId)!;
    assert.equal(
      active.runtimeProfileRevisionId,
      oldRevision.runtimeProfileRevisionId,
      "an Agent layer edit is not a RuntimeProfile change",
    );
    assert.deepEqual(active.manifest.adapter.fixedArgs, []);
    const editedDigest = digestFor("Edited persistent test Agent");
    assert.notEqual(editedDigest, oldKey.standingPromptDigest);
    assert.equal(
      await sessions.load({ ...oldKey, standingPromptDigest: editedDigest }),
      null,
      "the edited standing prompt cannot resume the previous Provider session",
    );
    assert.equal(
      (await sessions.load(oldKey))?.providerSessionId,
      "old-session-with-old-prompt",
    );
    assert.equal(
      await sessions.load({
        participantId: oldKey.participantId,
        provider: oldKey.provider,
        runtimeProfileRevisionId: oldKey.runtimeProfileRevisionId,
        workspaceMountRevisionId: oldKey.workspaceMountRevisionId,
      }),
      null,
      "a digest-free legacy key stays a distinct record",
    );
  } finally {
    registry?.close();
    rmSync(parent, { force: true, recursive: true });
  }
});

test("profile upgrades rotate immutable Offers and migrate only managed policy references without losing Agent configuration", async () => {
  const parent = mkdtempSync(join(tmpdir(), "rah-offer-upgrade-"));
  const workspaceCwd = join(parent, "workspace");
  const stateDirectory = join(parent, "state");
  mkdirSync(workspaceCwd);
  const spec = fakeRuntimeSpec(workspaceCwd);
  let kernel: RoomKernel | undefined;
  let registry: RuntimeProfileRegistry | undefined;
  try {
    const first = await prepareLocalWorkbench({
      runtimeSpecs: [spec],
      stateDirectory,
      workspaceCwd,
    });
    kernel = new RoomKernel({ databasePath: join(stateDirectory, "room.db") });
    kernel.initialize();
    registry = new RuntimeProfileRegistry({
      databasePath: first.registryDatabasePath,
      hostId: first.metadata.hostId,
    });
    registry.initialize();
    const human = kernel.authenticateHumanAccessToken(first.humanAccessToken);
    const host = kernel.authenticateHostAccessToken(first.hostAccessToken);
    kernel.heartbeatHost(host);
    const oldRevision = registry.getActiveRevision(spec.runtimeProfileId)!;
    const legacyId = "local-workbench-offer-test";
    const oldOffer = kernel.publishRuntimeOffer(
      host,
      buildRuntimeOfferFromProfile({
        hostId: host.hostId,
        hostInstanceId: host.instanceId,
        leaseUntil: new Date(Date.now() + 60_000).toISOString(),
        maxConcurrent: 1,
        observedAt: new Date().toISOString(),
        probeReport: registry.getLatestProbeReport(
          oldRevision.runtimeProfileRevisionId,
        )!,
        runtimeOfferId: legacyId,
        runtimeProfileRevision: oldRevision,
        state: "available",
      }),
    );
    const entry = kernel.listAgentCatalog(human)[0]!;
    const basePolicy = kernel.getExecutionPolicyRevision(
      entry.currentRevision.executionPolicyRevisionId,
    );
    const seq = () =>
      kernel!.sync(human, {
        consumerId: "upgrade-test",
        roomId: first.metadata.controlRoomId,
      }).latestRoomSeq;
    const oldPolicy = kernel.reviseExecutionPolicy(human, {
      ...basePolicy,
      basedOnRoomSeq: seq(),
      idempotencyKey: "legacy-custom-policy",
      modelIntent: {
        exactBindingIds: ["chosen-model"],
        reasoning: "low",
        fallback: "disabled",
      },
      required: {
        ...basePolicy.required,
        allowedOfferIds: [legacyId, "unmanaged-remote-offer"],
      },
      preferred: [
        { criterion: "runtime_offer", targetId: legacyId, weight: 10 },
      ],
    }).policy;
    const oldAgent = kernel.reviseAgentDefinition(human, {
      ...entry.currentRevision,
      basedOnRoomSeq: seq(),
      idempotencyKey: "custom-agent",
      executionPolicyRevisionId: oldPolicy.executionPolicyRevisionId,
      displayName: "Personal researcher",
      instructions: "Keep my role and memory across CLI upgrades.",
    }).revision;
    kernel.postMessage(human, {
      roomId: first.metadata.defaultRoomId,
      body: "Keep my history",
      recipients: [],
      idempotencyKey: "upgrade-history",
    });
    kernel.heartbeatHost(host, { state: "offline" });
    registry.close();
    registry = undefined;
    kernel.close();
    kernel = undefined;

    const second = await prepareLocalWorkbench({
      runtimeSpecs: [{ ...spec, displayName: "Test Agent, new profile" }],
      stateDirectory,
      workspaceCwd,
    });
    const newId = second.config.runtimes[0]!.offer.runtimeOfferId;
    assert.notEqual(
      newId,
      first.config.runtimes[0]!.offer.runtimeOfferId,
      "a changed profile must not republish its immutable predecessor Offer ID",
    );
    assert.notEqual(newId, legacyId);
    kernel = new RoomKernel({ databasePath: join(stateDirectory, "room.db") });
    kernel.initialize();
    const actor = kernel.authenticateHumanAccessToken(second.humanAccessToken);
    const current = kernel.listAgentCatalog(actor)[0]!.currentRevision;
    const policy = kernel.getExecutionPolicyRevision(
      current.executionPolicyRevisionId,
    );
    assert.deepEqual(policy.required, {
      ...oldPolicy.required,
      allowedOfferIds: [newId, "unmanaged-remote-offer"],
    });
    assert.deepEqual(policy.preferred, [
      { criterion: "runtime_offer", targetId: newId, weight: 10 },
    ]);
    for (const key of [
      "modelIntent",
      "toolAccessMode",
      "sessionPolicy",
      "retryPolicyRef",
    ] as const)
      assert.deepEqual(policy[key], oldPolicy[key]);
    for (const key of [
      "displayName",
      "description",
      "avatarKey",
      "role",
      "instructions",
      "instructionRefs",
      "skillRefs",
      "memoryPolicyRef",
    ] as const)
      assert.deepEqual(current[key], oldAgent[key]);
    assert.deepEqual(
      kernel.getExecutionPolicyRevision(oldPolicy.executionPolicyRevisionId),
      oldPolicy,
    );
    assert.deepEqual(
      kernel.getRuntimeOfferObservation(oldOffer.runtimeOfferObservationId),
      oldOffer,
    );
    assert.equal(
      kernel.listMessages(actor, { roomId: second.metadata.defaultRoomId })
        .messages[0]!.body,
      "Keep my history",
    );
    const afterMigrationSeq = kernel.sync(actor, {
      consumerId: "upgrade-test",
      roomId: second.metadata.controlRoomId,
    }).latestRoomSeq;
    registry = new RuntimeProfileRegistry({
      databasePath: second.registryDatabasePath,
      hostId: second.metadata.hostId,
    });
    registry.initialize();
    const active = registry.getActiveRevision(spec.runtimeProfileId)!;
    const nextHost = kernel.authenticateHostAccessToken(second.hostAccessToken);
    kernel.heartbeatHost(nextHost);
    const nextOffer = buildRuntimeOfferFromProfile({
      hostId: nextHost.hostId,
      hostInstanceId: nextHost.instanceId,
      leaseUntil: new Date(Date.now() + 60_000).toISOString(),
      maxConcurrent: 1,
      observedAt: new Date().toISOString(),
      probeReport: registry.getLatestProbeReport(
        active.runtimeProfileRevisionId,
      )!,
      runtimeOfferId: newId,
      runtimeProfileRevision: active,
      state: "available",
    });
    assert.throws(
      () =>
        kernel!.publishRuntimeOffer(nextHost, {
          ...nextOffer,
          runtimeOfferId: legacyId,
        }),
      /another Host or profile revision/u,
      "the Kernel identity guard must remain intact",
    );
    assert.equal(
      kernel.publishRuntimeOffer(nextHost, nextOffer).runtimeProfileRevisionId,
      active.runtimeProfileRevisionId,
    );
    registry.close();
    registry = undefined;
    kernel.close();
    kernel = undefined;
    const third = await prepareLocalWorkbench({
      runtimeSpecs: [{ ...spec, displayName: "Test Agent, new profile" }],
      stateDirectory,
      workspaceCwd,
    });
    assert.equal(third.config.runtimes[0]!.offer.runtimeOfferId, newId);
    kernel = new RoomKernel({ databasePath: join(stateDirectory, "room.db") });
    kernel.initialize();
    assert.equal(
      kernel.sync(kernel.authenticateHumanAccessToken(third.humanAccessToken), {
        consumerId: "upgrade-test",
        roomId: third.metadata.controlRoomId,
      }).latestRoomSeq,
      afterMigrationSeq,
      "repeated startup must not append duplicate migrations",
    );
  } finally {
    registry?.close();
    kernel?.close();
    rmSync(parent, { force: true, recursive: true });
  }
});
