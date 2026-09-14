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
import { basename, join } from "node:path";
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

/**
 * F0909B/E without a paid model: a second Human message lands at the same
 * target while the Agent is composing its result, so the send is freshness
 * held. The Agent recovers the saved draft by target alone through the real
 * Worker CLI and then answers the follow-up. The original result must not be
 * lost — that is the exact failure this reproduces.
 */
test("a busy freshness hold is recovered by target alone and never loses the original result", async () => {
  if (process.platform === "win32") return;
  const directory = mkdtempSync(join(tmpdir(), "rah-busy-hold-"));
  const stateDirectory = join(directory, "state");
  mkdirSync(stateDirectory, { mode: 0o700 });
  const databasePath = join(stateDirectory, "room.db");
  const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
  const secretPath = join(stateDirectory, "host.token");
  const barrierPath = join(stateDirectory, "busy-hold.barrier");
  // Concurrent test invocations must not compete for the global Host lock.
  const hostId = `busy-hold-${basename(directory)}`;
  const seed = new RoomKernel({ databasePath });
  const shutdown = new AbortController();
  let running: Promise<void> | undefined;
  let observer: RoomKernel | undefined;
  try {
    seed.initialize();
    const human = seed.provisionPrincipal({
      handle: "busy-human",
      kind: "human",
    });
    const agent = seed.provisionPrincipal({
      handle: "responder",
      kind: "agent",
    });
    const agentId = agent.principal.principalId;
    const humanActor = seed.authenticateAccessToken(human.accessToken);
    const workspace = seed.createWorkspace(humanActor, {
      idempotencyKey: "busy-hold-workspace-created",
      name: "Busy Hold Workspace",
      slug: "busy-hold-workspace",
    });
    const controlRoom = workspace.controlRoom;
    seed.addMember(humanActor, {
      principalId: agentId,
      roomId: controlRoom.roomId,
    });

    const offerId = "busy-hold-offer";
    const runtimeProfileId = "busy-hold-profile";
    const policy = seed.createExecutionPolicy(humanActor, {
      basedOnRoomSeq: latestRoomSeq(seed, humanActor, controlRoom.roomId),
      controlRoomId: controlRoom.roomId,
      idempotencyKey: "busy-hold-policy",
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
        artifactId: "busy-hold-retry",
        contentDigest: `sha256:${"1".repeat(64)}`,
        versionId: "busy-hold-retry-v1",
      },
      sessionPolicy: "fresh",
      toolAccessMode: "full_access",
    }).policy;
    const definition = seed.createAgentDefinition(humanActor, {
      basedOnRoomSeq: latestRoomSeq(seed, humanActor, controlRoom.roomId),
      controlRoomId: controlRoom.roomId,
      executionPolicyRevisionId: policy.executionPolicyRevisionId,
      idempotencyKey: "busy-hold-agent-definition",
      instructionRefs: [],
      memoryPolicyRef: {
        artifactId: "busy-hold-memory",
        contentDigest: `sha256:${"3".repeat(64)}`,
        versionId: "busy-hold-memory-v1",
      },
      participantId: agentId,
      role: "busy hold responder",
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
      displayName: "Busy hold fake worker",
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
        // One Activation at a time keeps the interrupted turn deterministic.
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
      { consumerId: "busy-hold-control", roomId: controlRoom.roomId },
    );
    const roomCreated = await clientRequest<{ room: { roomId: string } }>(
      "/v3/client/rooms/create",
      {
        basedOnControlRoomSeq: controlDelivery.latestRoomSeq,
        idempotencyKey: "busy-hold-room-created",
        kind: "channel",
        name: "Busy Hold Room",
        slug: "busy-hold-room",
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
          { consumerId: "busy-hold-console", roomId },
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

    const onboarded = await clientRequest<{ event: { roomSeq: number } }>(
      "/v3/client/agents/onboard",
      {
        agentDefinitionId: definition.definition.agentDefinitionId,
        basedOnRoomSeq: 1,
        idempotencyKey: "busy-hold-agent-onboard",
        roomId,
      },
    );
    assert.ok(onboarded.event.roomSeq > 0);

    // 1. The Human asks for a result; the Agent begins composing its reply.
    await humanMutation("/v3/client/messages/post", {
      body: "[BUSY-HOLD] Give me the migration result",
      idempotencyKey: "busy-hold-first-request",
      recipients: [{ participantId: agentId, reason: "mention" }],
      roomId,
    });
    await waitUntil(() => existsSync(`${barrierPath}.started`), 30_000);

    // 2. A second Human message arrives at the same target while it works.
    await humanMutation("/v3/client/messages/post", {
      body: "Also answer the follow-up, this does not cancel the first result",
      idempotencyKey: "busy-hold-second-request",
      recipients: [{ participantId: agentId, reason: "mention" }],
      roomId,
    });
    writeFileSync(barrierPath, "go\n");

    // 3. The Agent's send is held, recovered by target alone, and the
    //    follow-up is answered separately.
    const agentBodies = () =>
      roomEvents(activeObserver, humanActor, roomId)
        .filter(
          (event) =>
            event.type === "message.posted" && event.actorId === agentId,
        )
        .map((event) => String(event.payload.body));
    await waitUntil(() => agentBodies().length >= 2, 60_000);
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

    assert.deepEqual(
      agentBodies(),
      [ORIGINAL_RESULT, FOLLOW_UP_ANSWER],
      "the held original result must be published before the follow-up answer, and never lost",
    );
    const humanBodies = roomEvents(activeObserver, humanActor, roomId)
      .filter(
        (event) => event.type === "message.posted" && event.actorId !== agentId,
      )
      .map((event) => String(event.payload.body));
    assert.deepEqual(humanBodies, [
      "[BUSY-HOLD] Give me the migration result",
      "Also answer the follow-up, this does not cancel the first result",
    ]);

    // The CLI facade itself is the evidence: the held send exited nonzero and
    // the recovery carried nothing but the target.
    const transcript = JSON.parse(
      readFileSync(`${barrierPath}.log`, "utf8"),
    ) as { args: string[]; status: number; stderr: string; stdout: string }[];
    assert.equal(transcript.length, 3);
    assert.equal(transcript[0]?.status, 1, "a held send is not a delivery");
    // F0909G regression: the hold guidance must reach stdout. The real agent
    // redirected stderr only on sync/acknowledge, so a stderr-only hold notice
    // was invisible and the held original reply was silently discarded.
    assert.match(transcript[0]?.stdout ?? "", /SEND_HELD_AS_DRAFT/u);
    assert.match(
      transcript[0]?.stdout ?? "",
      /Your message has been saved as a draft\./u,
    );
    assert.match(
      transcript[0]?.stdout ?? "",
      /rah worker message-post --send-draft --target '#busy-hold-room'/u,
    );
    // Raft's `renderError` block: the code, whether a retry is allowed, what
    // effect the refusal had, whether the content survived, and the one next
    // action — all on stderr, none of it invented here.
    assert.equal(
      transcript[0]?.stderr,
      [
        "Error: Message held as draft; no target delivery occurred.",
        "Code: SEND_HELD_AS_DRAFT",
        "Retryable: no",
        "Effect: draft_saved",
        "Draft saved: yes",
        "Next action: Review the held context, then update the draft or send the current draft unchanged.",
        "",
      ].join("\n"),
    );
    assert.match(
      transcript[2]?.stdout ?? "",
      /Message sent to #busy-hold-room\. Message ID: /u,
    );
    assert.deepEqual(transcript[1]?.args, [
      "message-post",
      "--send-draft",
      "--target",
      "#busy-hold-room",
    ]);
    assert.equal(transcript[1]?.status, 0);
    assert.deepEqual(transcript[2]?.args, [
      "message-post",
      "--target",
      "#busy-hold-room",
    ]);
    assert.equal(transcript[2]?.status, 0);

    // 4. The same canonical ledger survives a fresh connection.
    shutdown.abort("busy-hold-complete");
    await running.catch(() => undefined);
    running = undefined;
    observer.close();
    observer = undefined;
    const reopened = new RoomKernel({ databasePath });
    try {
      reopened.initialize();
      const reopenedActor = reopened.authenticateAccessToken(human.accessToken);
      assert.deepEqual(
        roomEvents(reopened, reopenedActor, roomId)
          .filter(
            (event) =>
              event.type === "message.posted" && event.actorId === agentId,
          )
          .map((event) => String(event.payload.body)),
        [ORIGINAL_RESULT, FOLLOW_UP_ANSWER],
      );
    } finally {
      reopened.close();
    }
  } finally {
    shutdown.abort("busy-hold-cleanup");
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

function roomEvents(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
) {
  const collected: ReturnType<RoomKernel["sync"]>["events"] = [];
  let afterSeq: number | undefined;
  for (let page = 0; page < 50; page += 1) {
    const delivery = kernel.sync(actor, {
      consumerId: "busy-hold-verifier",
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
    taskClaimHeartbeatIntervalMs: 10_000,
    taskClaimLeaseMs: 30_000,
    workspace: {
      cwd: stateDirectory,
      mode: "in_place" as const,
      workspaceDefinitionId: "workspace-busy-hold",
      workspaceMountDigest: `sha256:${"a".repeat(64)}`,
      workspaceMountRevisionId: "workspace-mount-busy-hold-v1",
    },
  };
}

function latestRoomSeq(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["sync"]>[0],
  roomId: string,
): number {
  return kernel.sync(actor, { consumerId: "busy-hold-cursor", roomId })
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
