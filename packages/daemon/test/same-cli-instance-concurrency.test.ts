import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";
import type { RuntimeProfileManifestV2 } from "@rah-os/protocol";

import { DaemonApplication, DaemonConfigSchema } from "../src/index.ts";

const fakeCliPath = fileURLToPath(
  new URL("../../agent-host/test/fixtures/fake-cli.mjs", import.meta.url),
);

/**
 * Contract §3 through the composed daemon: the Host and offer caps are 2.
 * Two different instances run at the same time; the third is held (queued,
 * never failed) until a slot frees; a follow-up for a busy instance never
 * opens a second lane for it. Evidence is read from room.db, not from Fake CLI
 * output.
 */
test("different instances on one CLI offer run in parallel, one lane each, and excess work queues", async () => {
  if (process.platform === "win32") return;
  const {
    activeObserver,
    barrierPath,
    humanMutation,
    live,
    newAttempts,
    participantIds,
    roomId,
    stop,
  } = await startSameCliDaemon({ hostMaxConcurrent: 2, offerMaxConcurrent: 2 });
  try {
    await humanMutation("/v3/client/messages/post", {
      body: "Each of you, report in",
      idempotencyKey: "same-cli-fan-out",
      recipients: participantIds.map((participantId) => ({
        participantId,
        reason: "mention",
      })),
      roomId,
    });

    // Two different instances of the same CLI are running at once.
    await waitUntil(() => live().length === 2, 30_000);
    const runningParticipants = new Set(
      live().map((attempt) => attempt.participantId),
    );
    assert.equal(runningParticipants.size, 2, "two different instances");
    const [waitingParticipant] = participantIds.filter(
      (participantId) => !runningParticipants.has(participantId),
    );
    assert.ok(waitingParticipant);
    const [busyParticipant] = [...runningParticipants];
    assert.ok(busyParticipant);

    // A follow-up for a busy instance must not open a second lane for it.
    await humanMutation("/v3/client/messages/post", {
      body: "One more thing for you",
      idempotencyKey: "same-cli-busy-follow-up",
      recipients: [{ participantId: busyParticipant, reason: "mention" }],
      roomId,
    });
    let maxLive = 0;
    for (let sample = 0; sample < 25; sample += 1) {
      const current = live();
      maxLive = Math.max(maxLive, current.length);
      const perParticipant = new Map<string, number>();
      for (const attempt of current) {
        perParticipant.set(
          attempt.participantId,
          (perParticipant.get(attempt.participantId) ?? 0) + 1,
        );
      }
      for (const count of perParticipant.values())
        assert.equal(count, 1, "one instance never runs two lanes");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(maxLive, 2, "the offer cap of 2 is never exceeded");
    // The third instance's work is queued, not failed.
    const waitingActivations = activeObserver
      .listActivations({ roomId })
      .filter(
        (activation) =>
          activation.participantId === waitingParticipant &&
          activation.state !== "completed",
      );
    assert.ok(waitingActivations.length > 0);
    assert.ok(
      waitingActivations.every((activation) => activation.state === "queued"),
      JSON.stringify(waitingActivations),
    );
    assert.equal(
      newAttempts().filter(
        (attempt) => attempt.participantId === waitingParticipant,
      ).length,
      0,
    );

    // Release the barrier: the queued instance runs once a slot frees, and
    // nothing failed on the way.
    writeFileSync(barrierPath, "go\n");
    await waitForIdle(activeObserver, roomId, participantIds);
    const finished = newAttempts();
    assert.ok(
      finished.some((attempt) => attempt.participantId === waitingParticipant),
    );
    assert.deepEqual(
      finished.filter((attempt) => attempt.state !== "exited"),
      [],
      "no attempt failed while capacity was exhausted",
    );
    for (const participantId of participantIds) {
      const lane = finished
        .filter((attempt) => attempt.participantId === participantId)
        .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
      for (let index = 1; index < lane.length; index += 1) {
        const previousEnd = lane[index - 1]?.finishedAt;
        assert.ok(previousEnd);
        assert.ok(
          previousEnd <= (lane[index]?.startedAt ?? ""),
          "an instance's attempts are serial",
        );
      }
    }
    assert.equal(
      finished.filter((attempt) => attempt.participantId === busyParticipant)
        .length,
      2,
      "the busy instance's follow-up ran after its first turn",
    );
  } finally {
    await stop();
  }
});

/**
 * Owner ruling: two runtime-adjustable levels — the Host cap (all running
 * instances) and a per-CLI cap — plus the start-rate gate, changed through the
 * Human-authenticated daemon settings API without a restart. Either cap queues
 * new work; a change applies to the next scheduling decision and never touches
 * running work; the values are persisted.
 */
test("Host and per-CLI caps change at runtime through the settings API, queue excess work and persist", async () => {
  if (process.platform === "win32") return;
  const harness = await startSameCliDaemon({
    hostMaxConcurrent: 2,
    offerMaxConcurrent: 8,
  });
  const {
    activeObserver,
    barrierPath,
    clientRequest,
    humanMutation,
    live,
    participantIds,
    roomId,
    stateDirectory,
  } = harness;
  type Settings = {
    maxConcurrentRuns: number;
    maxConcurrentStarts: number;
    minStartIntervalMs: number;
    revision: number;
    runtimes: { maxConcurrentRuns: number; runtimeProfileId: string }[];
  };
  const update = async (body: Record<string, unknown>) => {
    const current = await clientRequest<Settings>(
      "/v3/client/runtime-settings/read",
      {},
    );
    return await clientRequest<Settings>("/v3/client/runtime-settings/update", {
      ...body,
      expectedRevision: current.revision,
    });
  };
  const holdsAt = async (expected: number) => {
    await waitUntil(() => live().length === expected, 30_000);
    for (let sample = 0; sample < 15; sample += 1) {
      assert.equal(live().length, expected, "the cap is never exceeded");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  let wakes = 0;
  const fanOut = async () =>
    await humanMutation("/v3/client/messages/post", {
      body: "Each of you, report in",
      idempotencyKey: `same-cli-settings-fan-out-${String((wakes += 1))}`,
      recipients: participantIds.map((participantId) => ({
        participantId,
        reason: "mention",
      })),
      roomId,
    });
  const release = async () => {
    writeFileSync(barrierPath, "go\n");
    await waitForIdle(activeObserver, roomId, participantIds);
    rmSync(barrierPath);
  };
  try {
    const initial = await clientRequest<Settings>(
      "/v3/client/runtime-settings/read",
      {},
    );
    assert.equal(initial.revision, 0);
    assert.equal(initial.maxConcurrentRuns, 2);
    const runtimeProfileId = initial.runtimes[0]?.runtimeProfileId;
    assert.ok(runtimeProfileId);
    assert.equal(initial.runtimes[0]?.maxConcurrentRuns, 4);
    const unauthenticated = await fetch(
      `${harness.origin}/v3/client/runtime-settings/read`,
      {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    assert.equal(unauthenticated.status, 401);
    // The pre-rename route is gone (no caller existed).
    await assert.rejects(
      clientRequest("/v3/client/runtime-concurrency/read", {}),
    );

    // Per-CLI cap 1: one instance runs, the other two queue.
    await update({ runtimes: [{ maxConcurrentRuns: 1, runtimeProfileId }] });
    await fanOut();
    await holdsAt(1);

    // Raising the per-CLI cap to 3 now meets the Host cap of 2.
    await update({ runtimes: [{ maxConcurrentRuns: 3, runtimeProfileId }] });
    await holdsAt(2);
    assert.ok(
      activeObserver
        .listActivations({ roomId })
        .some((activation) => activation.state === "queued"),
      "the third instance waits on the Host cap",
    );

    // Raising the Host cap adds a lane and places the third instance.
    await update({ maxConcurrentRuns: 3 });
    await holdsAt(3);

    // Lowering the Host cap never interrupts the three running instances...
    await update({ maxConcurrentRuns: 1 });
    await holdsAt(3);
    await release();
    // ...but the next round is scheduled under it.
    await fanOut();
    await holdsAt(1);
    await release();

    const starts = await update({
      maxConcurrentStarts: 2,
      minStartIntervalMs: 0,
    });
    assert.equal(starts.maxConcurrentStarts, 2);
    assert.equal(starts.minStartIntervalMs, 0);
    const persisted = JSON.parse(
      readFileSync(join(stateDirectory, "runtime-settings.json"), "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(persisted, {
      maxConcurrentRuns: 1,
      maxConcurrentStarts: 2,
      minStartIntervalMs: 0,
      revision: starts.revision,
      runtimeMaxConcurrentRuns: { [runtimeProfileId]: 3 },
    });

    // evo §37 C: the wake-guard and watchdog groups ride the same API,
    // document and revision.
    const guards = (await update({
      wakeGuard: { instanceChainLimit: 3 },
      watchdog: { maxRunMs: 2 * 60 * 60_000 },
    })) as Settings & {
      wakeGuard: { instanceChainLimit: number };
      watchdog: { maxRunMs: number; noProgressWarnMs: number };
    };
    assert.equal(guards.revision, starts.revision + 1);
    assert.equal(guards.wakeGuard.instanceChainLimit, 3);
    assert.equal(guards.watchdog.maxRunMs, 2 * 60 * 60_000);
    assert.equal(guards.watchdog.noProgressWarnMs, 15 * 60_000);
    assert.deepEqual(
      JSON.parse(
        readFileSync(join(stateDirectory, "runtime-settings.json"), "utf8"),
      ).watchdog,
      { maxRunMs: 2 * 60 * 60_000 },
    );
  } finally {
    await harness.stop();
  }
});

/**
 * Composed daemon with three instances sharing ONE CLI offer (one
 * RuntimeProfile, one RuntimeOffer). Every Fake CLI run waits at a barrier
 * before it acknowledges, so concurrency is observable in room.db.
 */
async function startSameCliDaemon(caps: {
  hostMaxConcurrent: number;
  offerMaxConcurrent: number;
}) {
  const directory = mkdtempSync(join(tmpdir(), "rah-same-cli-concurrency-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
  const secretPath = join(stateDirectory, "host.token");
  const barrierPath = join(stateDirectory, "same-cli.barrier");
  const hostId = "same-cli-concurrency-host";
  const offerId = "same-cli-concurrency-offer";
  const runtimeProfileId = "same-cli-concurrency-profile";
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  const stop = async () => {
    shutdown.abort("same-cli-concurrency-cleanup");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection is closed before the daemon starts.
    }
    rmSync(directory, { force: true, recursive: true });
  };
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "same-cli-human",
      kind: "human",
    });
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const workspace = seed.createWorkspace(humanActor, {
      idempotencyKey: "same-cli-workspace-created",
      name: "Same CLI Workspace",
      slug: "same-cli-workspace",
    });
    const controlRoom = workspace.controlRoom;
    const policy = seed.createExecutionPolicy(humanActor, {
      basedOnRoomSeq: latestRoomSeq(seed, humanActor, controlRoom.roomId),
      controlRoomId: controlRoom.roomId,
      idempotencyKey: "same-cli-policy",
      modelIntent: {
        fallback: "disabled",
        reasoning: "default",
        serviceTier: "default",
      },
      preferred: [],
      required: {
        allowedOfferIds: [offerId],
        allowedProtocolFamilies: ["rah-worker-process/v1"],
        capabilities: [],
        minimumIsolation: "none",
        workspaceMode: "in_place",
      },
      retryPolicyRef: {
        artifactId: "same-cli-retry",
        contentDigest: `sha256:${"1".repeat(64)}`,
        versionId: "same-cli-retry-v1",
      },
      sessionPolicy: "fresh",
      toolAccessMode: "full_access",
    }).policy;
    const instances = ["alpha", "beta", "gamma"].map((name, index) => {
      const agent = seed.provisionPrincipal({
        handle: `same-cli-${name}`,
        kind: "agent",
      });
      seed.addMember(humanActor, {
        principalId: agent.principal.principalId,
        roomId: controlRoom.roomId,
      });
      const definition = seed.createAgentDefinition(humanActor, {
        basedOnRoomSeq: latestRoomSeq(seed, humanActor, controlRoom.roomId),
        controlRoomId: controlRoom.roomId,
        executionPolicyRevisionId: policy.executionPolicyRevisionId,
        idempotencyKey: `same-cli-agent-definition-${name}`,
        instructionRefs: [],
        memoryPolicyRef: {
          artifactId: `same-cli-memory-${name}`,
          contentDigest: `sha256:${String(index + 3).repeat(64)}`,
          versionId: `same-cli-memory-${name}-v1`,
        },
        participantId: agent.principal.principalId,
        role: `same CLI role ${name}`,
        skillRefs: [],
      });
      return {
        agentId: definition.definition.agentId,
        participantId: agent.principal.principalId,
      };
    });
    const participantIds = instances.map((instance) => instance.participantId);
    const hostCredential = seed.provisionHostCredential({
      hostId,
      participantIds,
    });
    writeFileSync(secretPath, `${hostCredential.accessToken}\n`, {
      mode: 0o600,
    });

    const profileRegistry = new RuntimeProfileRegistry({
      databasePath: registryDatabasePath,
      hostId,
    });
    profileRegistry.initialize();
    const implementations = new RuntimeImplementationRegistry();
    const manifest: RuntimeProfileManifestV2 = {
      adapter: {
        config: { terminationGraceMs: 1_000 },
        executable: process.execPath,
        fixedArgs: [fakeCliPath],
        kind: "generic-process/v1",
      },
      credentialSlots: [],
      declaredCapabilities: ["worker_commands"],
      displayName: "Same CLI fake worker",
      manifestVersion: 2,
      protocolFamily: "rah-worker-process/v1",
      recoveryDrivers: ["rah-process-supervisor-v1"],
      runtimeProfileId,
      staticEnv: {
        RAH_FAKE_MODE: "worker-task",
        RAH_FAKE_PRE_SYNC_BARRIER_PATH: barrierPath,
        // No Room reply: replies would wake the other instances and make
        // the attempt counts timing-dependent.
      },
      workspacePolicy: { allowedModes: ["in_place"] },
    };
    const revision = profileRegistry.importManifest(manifest);
    profileRegistry.recordProbeReport(
      await implementations.probeRevision(revision, { cwd: stateDirectory }),
    );
    profileRegistry.activateRevision({
      contentDigest: revision.contentDigest,
      runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
    });
    profileRegistry.close();
    seed.close();

    const config = DaemonConfigSchema.parse({
      client: { bindHost: "127.0.0.1", port: 0 },
      drainTimeoutMs: 30_000,
      host: {
        credential: { path: secretPath, source: "file" },
        hostId,
        maxConcurrent: caps.hostMaxConcurrent,
        participantIds,
      },
      hostStaleAfterMs: 60_000,
      leaseMs: 30_000,
      outboxLeaseMs: 5_000,
      outboxPollIntervalMs: 20,
      outboxRetryAfterMs: 1_000,
      pollIntervalMs: 20,
      runtimes: [
        {
          credentialBindings: {},
          kind: "runtime-profile-registry",
          offer: {
            leaseMs: 1_000,
            maxConcurrent: caps.offerMaxConcurrent,
            refreshIntervalMs: 100,
            runtimeOfferId: offerId,
          },
          registryDatabasePath,
          runtimeProfileId,
        },
      ],
      runTimeoutMs: 60_000,
      runtimeCancelTimeoutMs: 10_000,
      runtimeRecoveryTimeoutMs: 30_000,
      runtimeStartTimeoutMs: 10_000,
      schemaVersion: 4,
      stateDirectory,
      // Channel homes stay inside the temporary state, never in ~/.loom.
      channelWorkspaceRoot: join(stateDirectory, "channel-workspaces"),
      taskClaimHeartbeatIntervalMs: 10_000,
      taskClaimLeaseMs: 30_000,
      workspace: {
        cwd: stateDirectory,
        mode: "in_place",
        workspaceDefinitionId: workspace.workspace.workspaceId,
        workspaceMountDigest: `sha256:${"a".repeat(64)}`,
        workspaceMountRevisionId: "workspace-mount-same-cli-v1",
      },
    });
    const application = new DaemonApplication({ config });
    running = application.run({ signal: shutdown.signal });
    observer = new RoomKernel({ databasePath });
    observer.initialize();
    const activeObserver = observer;
    await waitUntil(() => application.clientOrigin() !== undefined);
    const origin = application.clientOrigin();
    assert.ok(origin);

    const clientRequest = async <T>(
      path: string,
      body: Record<string, unknown>,
    ): Promise<T> => {
      const response = await fetch(`${origin}${path}`, {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${human.accessToken}`,
          "content-type": "application/json",
        },
        method: "POST",
      });
      const parsed = (await response.json()) as T;
      assert.equal(response.status, 200, JSON.stringify(parsed));
      return parsed;
    };
    const controlDelivery = await clientRequest<{ latestRoomSeq: number }>(
      "/v3/client/rooms/sync",
      { consumerId: "same-cli-control", roomId: controlRoom.roomId },
    );
    const roomId = (
      await clientRequest<{ room: { roomId: string } }>(
        "/v3/client/rooms/create",
        {
          basedOnControlRoomSeq: controlDelivery.latestRoomSeq,
          idempotencyKey: "same-cli-room-created",
          kind: "channel",
          name: "Same CLI Room",
          slug: "same-cli-room",
          workspaceId: workspace.workspace.workspaceId,
        },
      )
    ).room.roomId;
    const humanMutation = async (
      path: string,
      body: Record<string, unknown>,
    ): Promise<void> => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const delivery = await clientRequest<{ latestRoomSeq: number }>(
          "/v3/client/rooms/sync",
          { consumerId: "same-cli-console", roomId },
        );
        const response = await fetch(`${origin}${path}`, {
          body: JSON.stringify({
            ...body,
            basedOnRoomSeq: delivery.latestRoomSeq,
          }),
          headers: {
            authorization: `Bearer ${human.accessToken}`,
            "content-type": "application/json",
          },
          method: "POST",
        });
        const parsed = (await response.json()) as { error?: { code?: string } };
        if (response.status === 200) return;
        assert.equal(
          parsed.error?.code,
          "stale_context",
          `${path}: ${JSON.stringify(parsed)}`,
        );
      }
      throw new Error(`${path} never committed at the latest Room sequence`);
    };
    for (const instance of instances) {
      await humanMutation("/v3/client/agents/onboard", {
        agentId: instance.agentId,
        idempotencyKey: `same-cli-onboard-${instance.participantId}`,
        roomId,
      });
    }
    // Onboarding may itself wake instances; let that settle before measuring.
    writeFileSync(barrierPath, "go\n");
    await waitForIdle(activeObserver, roomId, participantIds);
    rmSync(barrierPath);

    const baselineAttemptIds = new Set(
      activeObserver
        .listRunAttempts({ roomId })
        .map((attempt) => attempt.runAttemptId),
    );
    const newAttempts = () =>
      activeObserver
        .listRunAttempts({ roomId })
        .filter((attempt) => !baselineAttemptIds.has(attempt.runAttemptId));
    const live = () =>
      newAttempts().filter(
        (attempt) =>
          attempt.state === "starting" || attempt.state === "running",
      );
    return {
      activeObserver,
      barrierPath,
      origin,
      clientRequest,
      humanMutation,
      live,
      newAttempts,
      participantIds,
      roomId,
      stop,
      stateDirectory,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function waitForIdle(
  kernel: RoomKernel,
  roomId: string,
  participantIds: readonly string[],
): Promise<void> {
  await waitUntil(
    () =>
      kernel
        .listActivations({ roomId })
        .every(
          (activation) =>
            !participantIds.includes(activation.participantId) ||
            (activation.state !== "queued" && activation.state !== "leased"),
        ) &&
      kernel
        .listRunAttempts({ roomId })
        .every(
          (attempt) =>
            attempt.state !== "starting" && attempt.state !== "running",
        ),
    60_000,
  );
}

function latestRoomSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, { consumerId: "same-cli-cursor", roomId })
    .latestRoomSeq;
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not met");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
