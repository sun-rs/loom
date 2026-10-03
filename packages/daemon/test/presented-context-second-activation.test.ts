import { bindRoleDefinitionFixture } from "../../kernel/test/role-definition-fixture.ts";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
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

const ORIGINAL_RESULT =
  "The migration result: schema v7 applied, 3 rows backfilled";
const FOLLOW_UP_ANSWER =
  "The follow-up answer: rollback is a single reverse migration";
const FOLLOW_UP_REQUEST =
  "Also answer the follow-up, this does not cancel the first result";

/**
 * F0909H, the incident shape end to end: a freshness hold during Activation A
 * shows this Agent the follow-up message, it answers that follow-up, and it can
 * only acknowledge through its own Activation range. Activation B is therefore
 * structurally required and is not suppressed — but its sync now states the two
 * facts the Agent previously spent a whole trajectory re-deriving:
 * `alreadyPresented` for the re-delivered follow-up, and `respondedAfter`
 * carrying this Agent's own later message at that target.
 */
test("the follow-up Activation's sync states that the message was already presented and already answered", async () => {
  if (process.platform === "win32") return;
  const directory = mkdtempSync(join(tmpdir(), "rah-presented-context-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
  const secretPath = join(stateDirectory, "host.token");
  const barrierPath = join(stateDirectory, "presented.barrier");
  const presentedLogPath = join(stateDirectory, "presented-sync.json");
  const hostId = "presented-context-host";
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "presented-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "presented-responder",
      kind: "agent",
    });
    const agentId = agent.principal.principalId;
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const workspace = seed.createWorkspace(humanActor, {
      idempotencyKey: "presented-workspace-created",
      name: "Presented Context Workspace",
      slug: "presented-context-workspace",
    });
    const controlRoom = workspace.controlRoom;
    seed.addMember(humanActor, {
      principalId: agentId,
      roomId: controlRoom.roomId,
    });

    const offerId = "presented-context-offer";
    const runtimeProfileId = "presented-context-profile";
    const policy = seed.createExecutionPolicy(humanActor, {
      basedOnRoomSeq: latestRoomSeq(seed, humanActor, controlRoom.roomId),
      controlRoomId: controlRoom.roomId,
      idempotencyKey: "presented-context-policy",
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
        artifactId: "presented-context-retry",
        contentDigest: `sha256:${"1".repeat(64)}`,
        versionId: "presented-context-retry-v1",
      },
      sessionPolicy: "fresh",
      toolAccessMode: "full_access",
    }).policy;
    const definition = seed.createAgentDefinition(humanActor, {
      basedOnRoomSeq: latestRoomSeq(seed, humanActor, controlRoom.roomId),
      controlRoomId: controlRoom.roomId,
      executionPolicyRevisionId: policy.executionPolicyRevisionId,
      idempotencyKey: "presented-context-agent-definition",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "presented-context-memory",
        contentDigest: `sha256:${"3".repeat(64)}`,
        versionId: "presented-context-memory-v1",
      },
      participantId: agentId,
      role: "presented context responder",
      skillRefs: [],
    });

    const hostCredential = seed.provisionHostCredential({
      hostId,
      participantIds: [agentId],
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
      displayName: "Presented context fake worker",
      manifestVersion: 2,
      protocolFamily: "rah-worker-process/v1",
      recoveryDrivers: ["rah-process-supervisor-v1"],
      runtimeProfileId,
      staticEnv: {
        RAH_FAKE_MODE: "worker-task",
        RAH_FAKE_BUSY_HOLD_RECOVERY: "1",
        RAH_FAKE_BUSY_HOLD_BARRIER: barrierPath,
        RAH_FAKE_BUSY_HOLD_RESULT: ORIGINAL_RESULT,
        RAH_FAKE_BUSY_HOLD_FOLLOW_UP: FOLLOW_UP_ANSWER,
        RAH_FAKE_PRESENTED_CONTEXT_LOG: presentedLogPath,
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

    const base = validConfig(stateDirectory, secretPath, hostId);
    const config = DaemonConfigSchema.parse({
      ...base,
      host: {
        ...base.host,
        hostId,
        maxConcurrent: 1,
        participantIds: [agentId],
      },
      runtimes: [
        {
          credentialBindings: {},
          kind: "runtime-profile-registry",
          offer: {
            leaseMs: 1_000,
            maxConcurrent: 1,
            refreshIntervalMs: 100,
            runtimeOfferId: offerId,
          },
          registryDatabasePath,
          runtimeProfileId,
        },
      ],
      workspace: {
        ...base.workspace,
        workspaceDefinitionId: workspace.workspace.workspaceId,
      },
    });
    const application = new DaemonApplication({
      config,
    });
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
      { consumerId: "presented-control", roomId: controlRoom.roomId },
    );
    const roomCreated = await clientRequest<{ room: { roomId: string } }>(
      "/v3/client/rooms/create",
      {
        basedOnControlRoomSeq: controlDelivery.latestRoomSeq,
        idempotencyKey: "presented-room-created",
        kind: "channel",
        name: "Presented Context Room",
        slug: "presented-context-room",
        workspaceId: workspace.workspace.workspaceId,
      },
    );
    const roomId = roomCreated.room.roomId;

    const humanMutation = async (
      path: string,
      body: Record<string, unknown>,
    ): Promise<void> => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const delivery = await clientRequest<{ latestRoomSeq: number }>(
          "/v3/client/rooms/sync",
          { consumerId: "presented-console", roomId },
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

    await clientRequest<{ event: { roomSeq: number } }>(
      "/v3/client/rooms/members/add",
      {
        principalId: definition.definition.participantId,
        role: "member",
        basedOnRoomSeq: 1,
        idempotencyKey: "presented-agent-onboard",
        roomId,
      },
    );

    bindRoleDefinitionFixture(
      activeObserver,
      humanActor,
      databasePath,
      definition.definition.agentId,
      roomId,
      offerId,
    );

    // 1. Human asks; the Agent begins composing and is pinned by the barrier.
    await humanMutation("/v3/client/messages/post", {
      body: "[BUSY-HOLD] Give me the migration result",
      idempotencyKey: "presented-first-request",
      recipients: [{ participantId: agentId, reason: "mention" }],
      roomId,
    });
    await waitUntil(() => existsSync(`${barrierPath}.started`), 30_000);

    // 2. The follow-up lands at the same target while the Agent is busy.
    await humanMutation("/v3/client/messages/post", {
      body: FOLLOW_UP_REQUEST,
      idempotencyKey: "presented-second-request",
      recipients: [{ participantId: agentId, reason: "mention" }],
      roomId,
    });
    writeFileSync(barrierPath, "go\n");

    // 3. The hold shows the follow-up, both replies are published, and the
    //    second Activation runs and records its own sync delivery.
    await waitUntil(() => existsSync(presentedLogPath), 60_000);
    await waitUntil(
      () =>
        activeObserver
          .listActivations({ roomId })
          .every(
            (activation) =>
              activation.participantId !== agentId ||
              (activation.state !== "queued" && activation.state !== "leased"),
          ),
      60_000,
    );

    // --- Ledger evidence, not prose. ---
    const events = roomEvents(activeObserver, humanActor, roomId);
    const messageEvent = (body: string) => {
      const found = events.find(
        (event) =>
          event.type === "message.posted" && event.payload.body === body,
      );
      assert.ok(found, `no message.posted event for ${body}`);
      return found;
    };
    const followUpRequest = messageEvent(FOLLOW_UP_REQUEST);
    const originalReply = messageEvent(ORIGINAL_RESULT);
    const followUpReply = messageEvent(FOLLOW_UP_ANSWER);
    assert.equal(originalReply.actorId, agentId);
    assert.equal(followUpReply.actorId, agentId);
    assert.ok(originalReply.roomSeq > followUpRequest.roomSeq);
    assert.ok(followUpReply.roomSeq > originalReply.roomSeq);

    // Two Activations, exactly as the incident: the second still had to exist,
    // because Activation A could never acknowledge past its own range.
    const activations = activeObserver
      .listActivations({ roomId })
      .filter((activation) => activation.participantId === agentId)
      .sort((left, right) => left.fromSeq - right.fromSeq);
    assert.equal(activations.length, 2, JSON.stringify(activations));
    assert.equal(activations[1]?.fromSeq, followUpRequest.roomSeq);
    assert.equal(activations[1]?.toSeq, followUpRequest.roomSeq);

    // The hold advanced the durable read position to the follow-up.
    const presentedThroughSeq = readPosition(databasePath, agentId, roomId);
    assert.equal(presentedThroughSeq, followUpRequest.roomSeq);

    // The Worker CLI's own sync output for the second Activation.
    const observed = JSON.parse(readFileSync(presentedLogPath, "utf8")) as {
      activationId: string | null;
      fromSeq: number;
      toSeq: number;
      syncText: string;
    };
    assert.equal(observed.activationId, activations[1]?.activationId);
    assert.equal(observed.fromSeq, followUpRequest.roomSeq);
    assert.equal(observed.toSeq, followUpRequest.roomSeq);
    // Delivery is unchanged: the follow-up is still re-delivered in the window,
    // and the Agent reads that as the rendered text Raft would have printed.
    assert.match(
      observed.syncText,
      new RegExp(
        `\\[target=#presented-context-room seq=${String(followUpRequest.roomSeq)} msg=${followUpRequest.payload.messageId as string} `,
        "u",
      ),
      observed.syncText,
    );
    assert.ok(
      observed.syncText.includes(
        `Presentation high-water: target ${roomId} seq ${String(followUpRequest.roomSeq)}; not a contiguous read frontier.`,
      ),
      observed.syncText,
    );
    // The 20 re-derivation steps in the incident were hunting for exactly this.
    assert.ok(
      observed.syncText.includes(
        `Already presented: seq ${String(followUpRequest.roomSeq)} (msg=${followUpRequest.payload.messageId as string}) was already presented; you posted 2 message(s) at that target afterwards (${originalReply.payload.messageId as string}, ${followUpReply.payload.messageId as string}).`,
      ),
      observed.syncText,
    );
  } finally {
    shutdown.abort("presented-context-cleanup");
    await running?.catch(() => undefined);
    observer?.close();
    try {
      seed.close();
    } catch {
      // The seed connection is closed before the daemon starts.
    }
    rmSync(directory, { force: true, recursive: true });
  }
});

function readPosition(
  databasePath: string,
  participantId: string,
  roomId: string,
): number | undefined {
  // The durable read position is Kernel-owned and has no client projection, so
  // this assertion reads room.db itself rather than any model's prose.
  const database = new DatabaseSync(databasePath);
  try {
    const found = database
      .prepare(
        `SELECT through_room_seq FROM worker_target_read_positions
         WHERE participant_id = ? AND room_id = ? AND thread_key = ''`,
      )
      .get(participantId, roomId);
    return found === undefined ? undefined : Number(found.through_room_seq);
  } finally {
    database.close();
  }
}

function roomEvents(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
) {
  const collected: ReturnType<RoomKernel["sync"]>["events"] = [];
  let afterSeq: number | undefined;
  for (let page = 0; page < 50; page += 1) {
    const delivery = kernel.sync(actor, {
      consumerId: "presented-context-verifier",
      limit: 500,
      roomId,
      ...(afterSeq === undefined ? {} : { afterSeq }),
    });
    collected.push(...delivery.events);
    if (delivery.cursorAfter >= delivery.latestRoomSeq) break;
    if (delivery.cursorAfter === afterSeq) break;
    afterSeq = delivery.cursorAfter;
  }
  return collected;
}

function validConfig(
  stateDirectory: string,
  secretPath: string,
  hostId: string,
) {
  return {
    client: { bindHost: "127.0.0.1" as const, port: 0 },
    drainTimeoutMs: 30_000,
    host: {
      credential: { path: secretPath, source: "file" as const },
      hostId,
      maxConcurrent: 1,
      participantIds: ["agent-a"],
    },
    hostStaleAfterMs: 60_000,
    leaseMs: 30_000,
    outboxLeaseMs: 5_000,
    outboxPollIntervalMs: 20,
    outboxRetryAfterMs: 1_000,
    pollIntervalMs: 20,
    runtimes: [],
    runTimeoutMs: 60_000,
    runtimeCancelTimeoutMs: 10_000,
    runtimeRecoveryTimeoutMs: 30_000,
    runtimeStartTimeoutMs: 10_000,
    schemaVersion: 4 as const,
    stateDirectory,
    // Channel homes stay inside the temporary state, never in ~/.loom.
    channelWorkspaceRoot: join(stateDirectory, "channel-workspaces"),
    taskClaimHeartbeatIntervalMs: 10_000,
    taskClaimLeaseMs: 30_000,
    workspace: {
      cwd: stateDirectory,
      mode: "in_place" as const,
      workspaceDefinitionId: "workspace-presented-context",
      workspaceMountDigest: `sha256:${"a".repeat(64)}`,
      workspaceMountRevisionId: "workspace-mount-presented-context-v1",
    },
  };
}

function latestRoomSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, { consumerId: "presented-cursor", roomId })
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
