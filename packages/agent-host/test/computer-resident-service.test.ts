import assert from "node:assert/strict";
import test from "node:test";

import type {
  ComputerHeartbeatRequest,
  ComputerHeartbeatResponse,
  ComputerPlacementClaimRequest,
  ComputerPlacementClaimResponse,
  ComputerRuntimeOfferPublishRequest,
  ComputerRuntimeOfferPublishResponse,
  ComputerSessionOpenRequest,
  ComputerSessionOpenResponse,
} from "@rah-os/computer-protocol";
import type { RuntimeOffer } from "@rah-os/protocol";

import {
  ComputerControlClientError,
  ComputerResidentService,
  ComputerResidentServiceTerminalError,
  type ComputerControlClientPort,
} from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;

function offer(
  hostId: string,
  hostInstanceId: string,
  observedAt = "2026-08-28T00:00:00.000Z",
): RuntimeOffer {
  return {
    capacityPoolIds: ["pool-resident"],
    certificationRefs: [
      {
        certificationDigest: digest("c"),
        certificationId: "certification-resident",
      },
    ],
    capabilityEvidence: [
      { capability: "worker_commands", evidence: "certified" },
    ],
    hostId,
    hostInstanceId,
    isolation: { evidence: "certified", level: "process" },
    leaseUntil: "2026-08-28T00:01:00.000Z",
    maxConcurrent: 1,
    modelBindingDescriptors: [],
    observedAt,
    protocolFamily: "rah-worker-process/v1",
    revisionDigest: digest("d"),
    runtimeOfferId: "offer-resident",
    runtimeProfileId: "profile-resident",
    runtimeProfileRevisionId: "profile-resident-v1",
    state: "available",
    workspaceMountDescriptors: [
      {
        modes: ["in_place"],
        workspaceDefinitionId: "workspace-resident",
        workspaceMountDigest: digest("e"),
        workspaceMountRevisionId: "mount-resident-v1",
      },
    ],
  };
}

class FakeComputerControlClient implements ComputerControlClientPort {
  readonly calls: string[] = [];
  failHeartbeatOnce = false;
  openError: ComputerControlClientError | undefined;
  sessionNumber = 0;

  async acknowledgeOperation(): Promise<never> {
    throw new Error("managed operations are not used by this fixture");
  }

  async commandExecution(): Promise<never> {
    throw new Error("execution commands are not used by this fixture");
  }

  async claimOperation(): Promise<never> {
    throw new Error("managed operations are not used by this fixture");
  }

  async issueWorkerCredential(): Promise<never> {
    throw new Error("Worker credentials are not used by this fixture");
  }

  async revokeWorkerCredential(): Promise<never> {
    throw new Error("Worker credentials are not used by this fixture");
  }

  async openSession(
    request: ComputerSessionOpenRequest,
  ): Promise<ComputerSessionOpenResponse> {
    this.calls.push(`open:${request.connectionId}`);
    if (this.openError !== undefined) throw this.openError;
    this.sessionNumber += 1;
    return {
      acceptedControlApiVersion: 1,
      hostId: "host-resident",
      hostInstanceId: `host-instance-${String(this.sessionNumber)}`,
      serverTime: "2026-08-28T00:00:00.000Z",
      sessionAccessToken: `rah_host_session_${"a".repeat(32)}_${String(this.sessionNumber)}`,
      sessionExpiresAt: "2026-08-28T00:01:00.000Z",
    };
  }

  async heartbeat(
    sessionAccessToken: string,
    request: ComputerHeartbeatRequest,
  ): Promise<ComputerHeartbeatResponse> {
    this.calls.push(
      `heartbeat:${request.state}:${sessionAccessToken.slice(-1)}`,
    );
    if (this.failHeartbeatOnce) {
      this.failHeartbeatOnce = false;
      throw new ComputerControlClientError(
        "unauthenticated",
        "fixture session expired",
      );
    }
    return {
      host: {
        hostId: "host-resident",
        instanceId: `host-instance-${sessionAccessToken.slice(-1)}`,
        lastSeenAt: "2026-08-28T00:00:01.000Z",
        participantIds: ["agent-resident"],
        state: request.state,
      },
      serverTime: "2026-08-28T00:00:01.000Z",
      sessionExpiresAt: "2026-08-28T00:01:01.000Z",
    };
  }

  async publishRuntimeOffer(
    _sessionAccessToken: string,
    request: ComputerRuntimeOfferPublishRequest,
  ): Promise<ComputerRuntimeOfferPublishResponse> {
    this.calls.push(`offer:${request.offer.hostInstanceId}`);
    return {
      offer: {
        ...request.offer,
        acceptedAt: request.offer.observedAt,
        resolvedCertifications: [
          {
            capabilities: ["worker_commands"],
            certificationDigest: digest("c"),
            certificationId: "certification-resident",
            maximumIsolation: "process",
            protocolFamily: "rah-worker-process/v1",
            runtimeProfileDigest: digest("d"),
          },
        ],
        runtimeOfferObservationId: "observation-resident",
        runtimeOfferSnapshotDigest: digest("f"),
      },
    };
  }

  async claimPlacement(
    _sessionAccessToken: string,
    _request: ComputerPlacementClaimRequest,
  ): Promise<ComputerPlacementClaimResponse> {
    this.calls.push("claim");
    return { claim: null };
  }
}

function service(
  client: FakeComputerControlClient,
  onConnected?: () => void,
): ComputerResidentService {
  return new ComputerResidentService({
    buildVersion: "resident-fixture/1.0.0",
    client,
    connectionId: "connection-resident-stable",
    ...(onConnected === undefined ? {} : { onConnected }),
    runtimeOffers: async ({ hostId, hostInstanceId }) => [
      offer(hostId, hostInstanceId),
    ],
    runtimeProtocolVersion: 1,
  });
}

test("resident service becomes connected only after session, heartbeat, and Offer publication", async () => {
  const client = new FakeComputerControlClient();
  let connectedEvents = 0;
  const resident = service(client, () => {
    connectedEvents += 1;
  });

  const connected = await resident.reconcileOnce();
  assert.equal(connected.state, "connected");
  assert.equal(connected.hostId, "host-resident");
  assert.equal(connected.hostInstanceId, "host-instance-1");
  assert.equal(connectedEvents, 1);
  assert.deepEqual(client.calls, [
    "open:connection-resident-stable",
    "heartbeat:online:1",
    "offer:host-instance-1",
  ]);

  await resident.reconcileOnce();
  assert.equal(
    connectedEvents,
    1,
    "steady reconcile must not repeat readiness",
  );
  assert.equal(
    client.calls.filter((call) => call.startsWith("open:")).length,
    1,
  );
});

test("resident service discards an expired short session and reopens the same connection", async () => {
  const client = new FakeComputerControlClient();
  const resident = service(client);
  await resident.reconcileOnce();

  client.failHeartbeatOnce = true;
  const disconnected = await resident.reconcileOnce();
  assert.equal(disconnected.state, "disconnected");
  assert.equal(disconnected.consecutiveFailures, 1);

  const reconnected = await resident.reconcileOnce();
  assert.equal(reconnected.state, "connected");
  assert.equal(reconnected.hostInstanceId, "host-instance-2");
  assert.deepEqual(
    client.calls.filter((call) => call.startsWith("open:")),
    ["open:connection-resident-stable", "open:connection-resident-stable"],
  );
});

test("resident service parks when the long-lived attachment is revoked", async () => {
  const client = new FakeComputerControlClient();
  client.openError = new ComputerControlClientError(
    "unauthenticated",
    "attachment revoked",
  );
  const resident = service(client);

  await assert.rejects(
    resident.reconcileOnce(),
    (error: unknown) =>
      error instanceof ComputerResidentServiceTerminalError &&
      error.reason === "attachment_revoked",
  );
  assert.equal(resident.snapshot().state, "degraded");
});

test("resident service treats network loss as retryable, not terminal", async () => {
  const client = new FakeComputerControlClient();
  client.openError = new ComputerControlClientError(
    "unavailable",
    "fixture network unavailable",
  );
  const resident = service(client);

  const snapshot = await resident.reconcileOnce();
  assert.equal(snapshot.state, "disconnected");
  assert.equal(snapshot.consecutiveFailures, 1);
  assert.match(snapshot.lastError ?? "", /network unavailable/u);
});

test("resident service reports offline before surfacing a post-connect configuration terminal", async () => {
  const client = new FakeComputerControlClient();
  const resident = new ComputerResidentService({
    buildVersion: "resident-fixture/1.0.0",
    client,
    connectionId: "connection-resident-invalid-profile",
    runtimeOffers: async () => {
      throw new Error("fixture Runtime Profile is invalid");
    },
    runtimeProtocolVersion: 1,
  });

  await assert.rejects(
    resident.reconcileOnce(),
    (error: unknown) =>
      error instanceof ComputerResidentServiceTerminalError &&
      error.reason === "configuration",
  );
  assert.equal(resident.snapshot().state, "degraded");
  assert.equal(client.calls.at(-1), "heartbeat:offline:1");
});

test("resident service reports offline with its current session during graceful stop", async () => {
  const client = new FakeComputerControlClient();
  const resident = service(client);
  await resident.reconcileOnce();

  const stopped = await resident.stop();
  assert.equal(stopped.state, "stopped");
  assert.equal(client.calls.at(-1), "heartbeat:offline:1");
});

test("resident service runner reconciles on a bounded cadence and drains on abort", async () => {
  const client = new FakeComputerControlClient();
  client.openError = new ComputerControlClientError(
    "unavailable",
    "fixture starts offline",
  );
  const shutdown = new AbortController();
  const waits: number[] = [];
  const resident = new ComputerResidentService({
    buildVersion: "resident-fixture/1.0.0",
    client,
    connectionId: "connection-resident-runner",
    onConnected: () => shutdown.abort("fixture complete"),
    reconcileIntervalMs: 5_000,
    runtimeOffers: async ({ hostId, hostInstanceId }) => [
      offer(hostId, hostInstanceId),
    ],
    runtimeProtocolVersion: 1,
    wait: async (delayMs) => {
      waits.push(delayMs);
      client.openError = undefined;
    },
  });

  await resident.run({ signal: shutdown.signal });
  assert.deepEqual(waits, [5_000]);
  assert.equal(resident.snapshot().state, "stopped");
  assert.equal(client.calls.at(-1), "heartbeat:offline:1");
});
