import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir, hostname } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildRuntimeOfferFromProfile,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import { ProviderSessionStore } from "../../agent-host/src/provider-session-store.ts";
import { RoomKernel } from "@rah-os/kernel";

import {
  prepareLocalWorkbench,
  type LocalWorkbenchRuntimeSpec,
} from "../src/local-workbench-bootstrap.ts";
import { localWorkbenchWorkerPrompt } from "../src/local-cli-runtime-spec.ts";

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

function fakeRuntimeSpec(workspaceCwd: string): LocalWorkbenchRuntimeSpec {
  return {
    adapterKind: "generic-process/v1",
    agentHandle: "TestAgent",
    args: ["--version"],
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

test("normal bootstrap activates a new memory prompt revision without mutating old revisions or reusing their sessions", async () => {
  const parent = mkdtempSync(join(tmpdir(), "rah-memory-prompt-revision-"));
  const workspaceCwd = join(parent, "workspace");
  const stateDirectory = join(parent, "state");
  mkdirSync(workspaceCwd);
  const base = fakeRuntimeSpec(workspaceCwd);
  const currentPrompt = localWorkbenchWorkerPrompt();
  const oldPrompt = `${currentPrompt}\nLegacy test-only memory policy`;
  const spec = (prompt: string): LocalWorkbenchRuntimeSpec => ({
    ...base,
    args: ["-e", "process.stdout.write(process.argv[1])", prompt],
  });
  let registry: RuntimeProfileRegistry | undefined;
  try {
    const old = await prepareLocalWorkbench({
      runtimeSpecs: [spec(oldPrompt)],
      stateDirectory,
      workspaceCwd,
    });
    registry = new RuntimeProfileRegistry({
      databasePath: old.registryDatabasePath,
      hostId: old.metadata.hostId,
    });
    registry.initialize();
    const oldRevision = registry.getActiveRevision(base.runtimeProfileId)!;
    const sessions = new ProviderSessionStore({
      rootDirectory: join(parent, "provider-sessions"),
    });
    const oldKey = {
      participantId: old.metadata.bootstrapParticipantIds[0]!,
      provider: "codex-app-server/v1" as const,
      runtimeProfileRevisionId: oldRevision.runtimeProfileRevisionId,
      workspaceMountRevisionId: "workspace-test-v1",
    };
    await sessions.record(oldKey, "old-session-with-old-prompt");
    registry.close();
    registry = undefined;

    const current = await prepareLocalWorkbench({
      runtimeSpecs: [spec(currentPrompt)],
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
    assert.notEqual(
      active.runtimeProfileRevisionId,
      oldRevision.runtimeProfileRevisionId,
    );
    assert.equal(active.manifest.adapter.fixedArgs.at(-1), currentPrompt);
    assert.deepEqual(
      registry.getRevision(oldRevision.runtimeProfileRevisionId).manifest,
      oldRevision.manifest,
    );
    assert.equal(
      await sessions.load({
        ...oldKey,
        runtimeProfileRevisionId: active.runtimeProfileRevisionId,
      }),
      null,
    );
    assert.equal(
      (await sessions.load(oldKey))?.providerSessionId,
      "old-session-with-old-prompt",
    );
    registry.activateRevision({
      runtimeProfileRevisionId: oldRevision.runtimeProfileRevisionId,
      contentDigest: oldRevision.contentDigest,
    });
    assert.equal(
      registry
        .getActiveRevision(base.runtimeProfileId)
        ?.manifest.adapter.fixedArgs.at(-1),
      oldPrompt,
      "explicit registry rollback still selects the immutable old prompt",
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
      runtimeSpecs: [{ ...spec, args: ["--version", "new-profile"] }],
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
      runtimeSpecs: [{ ...spec, args: ["--version", "new-profile"] }],
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
