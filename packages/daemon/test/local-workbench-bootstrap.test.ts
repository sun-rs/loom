import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
    // Contract §2 (owner 2026-09-27): a new data home seeds no legacy persona
    // Agent; the Host scope starts empty and grows as Role instances are
    // created.
    assert.deepEqual(first.metadata.bootstrapParticipantIds, []);
    assert.deepEqual(first.config.host.participantIds, []);
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
    assert.equal(first.metadata.defaultRoomId, undefined);
    assert.equal(
      kernel
        .listRooms(human, { workspaceId: first.metadata.workspaceId })
        .filter((r) => r.kind === "channel").length,
      0,
    );
    const fixtureRoom = kernel.createWorkspaceRoom(human, {
      workspaceId: first.metadata.workspaceId,
      basedOnControlRoomSeq: kernel.sync(human, {
        roomId: first.metadata.controlRoomId,
        consumerId: "test",
      }).latestRoomSeq,
      name: "fixture",
      slug: "fixture",
      kind: "channel",
      idempotencyKey: "fixture",
    }).room.roomId;
    kernel.postMessage(human, {
      body: "persistent message",
      idempotencyKey: "restart-proof-message",
      recipients: [],
      roomId: fixtureRoom,
    });
    assert.deepEqual(
      kernel.listAgentCatalog(human, {
        controlRoomId: first.metadata.controlRoomId,
        includeDeleted: true,
      }),
      [],
      "no persona Agent definition is seeded",
    );
    assert.deepEqual(
      kernel
        .listRoomMemberships(human, { roomId: fixtureRoom })
        .map(({ principalId }) => principalId),
      [human.principalId],
      "the default Channel holds only the Human",
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
        roomId: fixtureRoom,
      }).messages[0]?.body,
      "persistent message",
    );
    assert.deepEqual(
      reopened.authenticateHostAccessToken(second.hostAccessToken)
        .participantIds,
      [],
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
      participantId: "participant-under-test",
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
    // An Agent definition as an older data home's bootstrap seeded it (a
    // legacy persona), whose policy names the managed Offer.
    const controlRoomId = first.metadata.controlRoomId;
    const controlSeq = () =>
      kernel!.sync(human, {
        consumerId: "upgrade-test-seed",
        roomId: controlRoomId,
      }).latestRoomSeq;
    const older = kernel.provisionPrincipal({
      handle: spec.agentHandle,
      kind: "agent",
    });
    kernel.addMember(human, {
      principalId: older.principal.principalId,
      roomId: controlRoomId,
    });
    const seededPolicy = kernel.createExecutionPolicy(human, {
      basedOnRoomSeq: controlSeq(),
      controlRoomId,
      idempotencyKey: "older-home-policy",
      modelIntent: {
        fallback: "disabled",
        reasoning: spec.reasoning,
        serviceTier: "default",
      },
      preferred: [],
      required: {
        allowedOfferIds: [legacyId],
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [],
        minimumIsolation: "none",
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: "older-home-retry",
        contentDigest: `sha256:${"b".repeat(64)}`,
        versionId: "retry-v1",
      },
      sessionPolicy: "fresh",
      toolAccessMode: spec.toolAccessMode,
    }).policy;
    kernel.createAgentDefinition(human, {
      avatarKey: spec.avatarKey,
      basedOnRoomSeq: controlSeq(),
      controlRoomId,
      description: spec.description,
      displayName: spec.displayName,
      executionPolicyRevisionId: seededPolicy.executionPolicyRevisionId,
      executionWorkspace: { kind: "agent_private" },
      idempotencyKey: "older-home-definition",
      instructionRefs: [],
      instructions: spec.instructions,
      memoryPolicyRef: {
        artifactId: "older-home-memory",
        contentDigest: `sha256:${"c".repeat(64)}`,
        versionId: "room-private-v1",
      },
      participantId: older.principal.principalId,
      role: spec.role,
      skillRefs: [],
    });
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
    const fixtureRoom = kernel.createWorkspaceRoom(human, {
      workspaceId: first.metadata.workspaceId,
      basedOnControlRoomSeq: seq(),
      name: "history",
      slug: "history",
      kind: "channel",
      idempotencyKey: "history",
    }).room.roomId;
    kernel.postMessage(human, {
      roomId: fixtureRoom,
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
      kernel.listMessages(actor, { roomId: fixtureRoom }).messages[0]!.body,
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

test("deleting a legacy default all channel survives restart without recreating any channel", async () => {
  const parent = mkdtempSync(join(tmpdir(), "loom-no-system-channel-"));
  const stateDirectory = join(parent, "state"),
    workspaceCwd = join(parent, "workspace");
  mkdirSync(workspaceCwd);
  const input = {
    stateDirectory,
    workspaceCwd,
    runtimeSpecs: [fakeRuntimeSpec(workspaceCwd)],
  };
  try {
    const first = await prepareLocalWorkbench(input);
    const k = new RoomKernel({ databasePath: join(stateDirectory, "room.db") });
    k.initialize();
    const actor = k.authenticateHumanAccessToken(first.humanAccessToken);
    const room = k.createWorkspaceRoom(actor, {
      workspaceId: first.metadata.workspaceId,
      basedOnControlRoomSeq: k.sync(actor, {
        roomId: first.metadata.controlRoomId,
        consumerId: "test",
      }).latestRoomSeq,
      name: "all",
      slug: "all",
      kind: "channel",
      visibility: "public",
      idempotencyKey: "legacy-all",
    }).room;
    // Simulate the old launcher navigation pointer, not a second business owner.
    writeFileSync(
      join(stateDirectory, "workbench.json"),
      JSON.stringify({ ...first.metadata, defaultRoomId: room.roomId }),
    );
    k.deleteWorkspaceRoom(actor, {
      roomId: room.roomId,
      basedOnRoomSeq: k.sync(actor, { roomId: room.roomId, consumerId: "test" })
        .latestRoomSeq,
      idempotencyKey: "remove-all",
    });
    k.close();
    const restarted = await prepareLocalWorkbench(input);
    assert.equal(restarted.metadata.defaultRoomId, undefined);
    const reopened = new RoomKernel({
      databasePath: join(stateDirectory, "room.db"),
    });
    reopened.initialize();
    try {
      assert.equal(
        reopened
          .listRooms(
            reopened.authenticateHumanAccessToken(first.humanAccessToken),
            { workspaceId: first.metadata.workspaceId },
          )
          .filter((r) => r.kind === "channel").length,
        0,
      );
    } finally {
      reopened.close();
    }
    assert.equal(
      (await prepareLocalWorkbench(input)).metadata.defaultRoomId,
      undefined,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
