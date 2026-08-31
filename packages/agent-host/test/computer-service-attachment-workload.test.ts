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

import {
  ComputerServiceAttachmentWorkload,
  createRemoteComputerServiceAttachmentWorkload,
  FakeRuntimeAdapter,
  type ComputerAttachment,
  type ComputerControlClientPort,
  type ComputerServiceAttachmentManagerPort,
} from "../src/index.ts";

function attachment(
  attachmentId: string,
  connectionId: string,
): ComputerAttachment {
  return {
    attachmentId,
    connectionId,
    createdAt: "2026-08-28T00:00:00.000Z",
    hostAccessToken: `rah_host_${"a".repeat(48)}`,
    origin: "https://control.example.test",
  };
}

class FakeManager implements ComputerServiceAttachmentManagerPort {
  readonly controller = new AbortController();
  runCount = 0;
  stopCount = 0;

  async run(input: { signal: AbortSignal }): Promise<void> {
    this.runCount += 1;
    await aborted(AbortSignal.any([input.signal, this.controller.signal]));
  }

  async stop(): Promise<unknown> {
    this.stopCount += 1;
    this.controller.abort("manager stopped");
    return undefined;
  }
}

test("Computer service workload remains parked across successor startup until exact release", async () => {
  const attachments = [
    attachment("primary", "connection-primary"),
    attachment("secondary", "connection-secondary"),
  ];
  const managers: FakeManager[] = [];
  const workload = new ComputerServiceAttachmentWorkload({
    attachmentStore: {
      read: async () => attachments.map((record) => ({ ...record })),
    },
    createManager: () => {
      const manager = new FakeManager();
      managers.push(manager);
      return manager;
    },
    parkedStore: {
      read: async () => ({
        primary: "connection-primary",
        secondary: "connection-secondary",
      }),
    },
  });
  const controller = new AbortController();
  const running = workload.run({ signal: controller.signal });

  await nextTurn();
  assert.deepEqual(await workload.managedAttachmentIdentities(), {
    primary: "connection-primary",
    secondary: "connection-secondary",
  });
  assert.equal(managers.length, 0, "parked successor cannot reconnect early");

  await workload.releaseManagedAttachmentsHold();
  await waitFor(() => managers.length === 1 && managers[0]!.runCount === 1);

  await workload.holdManagedAttachments({
    primary: "connection-primary",
    secondary: "connection-secondary",
  });
  assert.equal(managers[0]!.stopCount, 1);

  await workload.releaseManagedAttachmentsHold();
  await waitFor(() => managers.length === 2 && managers[1]!.runCount === 1);
  controller.abort("test complete");
  await running;
  assert.equal(managers[1]!.stopCount, 1);
});

test("Computer service workload refuses catalog drift before hold or parked startup", async () => {
  const records = [attachment("primary", "connection-primary")];
  const managers: FakeManager[] = [];
  const workload = new ComputerServiceAttachmentWorkload({
    attachmentStore: { read: async () => records },
    createManager: () => {
      const manager = new FakeManager();
      managers.push(manager);
      return manager;
    },
    parkedStore: { read: async () => null },
  });
  const controller = new AbortController();
  const running = workload.run({ signal: controller.signal });
  await waitFor(() => managers.length === 1 && managers[0]!.runCount === 1);

  records[0] = attachment("primary", "connection-replaced");
  await assert.rejects(
    workload.holdManagedAttachments({ primary: "connection-primary" }),
    /managed attachment set changed before hold/u,
  );
  assert.equal(managers[0]!.stopCount, 0);
  controller.abort("test complete");
  await running;

  const driftedStartup = new ComputerServiceAttachmentWorkload({
    attachmentStore: { read: async () => records },
    createManager: () => new FakeManager(),
    parkedStore: {
      read: async () => ({ primary: "connection-primary" }),
    },
  });
  await assert.rejects(
    driftedStartup.run({ signal: new AbortController().signal }),
    /parked managed attachment set does not match the catalog/u,
  );
});

test("Computer service workload propagates an unexpected manager exit", async () => {
  const workload = new ComputerServiceAttachmentWorkload({
    attachmentStore: {
      read: async () => [attachment("primary", "connection-primary")],
    },
    createManager: () => ({
      run: async () => undefined,
      stop: async () => undefined,
    }),
    parkedStore: { read: async () => null },
  });

  await assert.rejects(
    workload.run({ signal: new AbortController().signal }),
    /attachment manager stopped unexpectedly/u,
  );
});

test("production Computer workload composes remote AgentHost workers and restarts them after release", async () => {
  const record = attachment("primary", "connection-primary");
  const clients: WorkloadControlClient[] = [];
  const workload = createRemoteComputerServiceAttachmentWorkload({
    agentHost: () => {
      const runtime = new FakeRuntimeAdapter();
      return {
        leaseMs: 30_000,
        placementRuntimeResolver: () => runtime,
        pollIntervalMs: 10,
        runtime,
      };
    },
    attachmentStore: { read: async () => [{ ...record }] },
    buildVersion: "computer-workload/1.0.0",
    capacity: 1,
    clientFactory: () => {
      const client = new WorkloadControlClient();
      clients.push(client);
      return client;
    },
    computerInstanceId: "computer-service-incarnation",
    parkedStore: { read: async () => null },
    reconcileIntervalMs: 10,
    runtimeOffers: async () => [],
    runtimeProtocolVersion: 1,
  });
  const controller = new AbortController();
  const running = workload.run({ signal: controller.signal });
  await workload.ready();
  await waitFor(() => clients[0]?.calls.includes("claim-placement") === true);
  assert.deepEqual(clients[0]!.computerInstanceIds, [
    "computer-service-incarnation",
  ]);

  await workload.holdManagedAttachments({
    primary: "connection-primary",
  });
  assert.equal(clients[0]!.calls.at(-1), "heartbeat:offline");
  await workload.releaseManagedAttachmentsHold();
  await waitFor(
    () => clients.length === 2 && clients[1]!.calls.includes("claim-placement"),
  );
  assert.deepEqual(clients[1]!.computerInstanceIds, [
    "computer-service-incarnation",
  ]);
  controller.abort("test complete");
  await running;
});

class WorkloadControlClient implements ComputerControlClientPort {
  readonly calls: string[] = [];
  readonly computerInstanceIds: string[] = [];

  async acknowledgeOperation(): Promise<never> {
    throw new Error("managed operations are not used by this fixture");
  }

  async claimOperation(): Promise<never> {
    throw new Error("managed operations are not used by this fixture");
  }

  async commandExecution(): Promise<never> {
    throw new Error("execution commands are not used by this fixture");
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
    this.calls.push("open");
    this.computerInstanceIds.push(request.computerInstanceId);
    return {
      acceptedControlApiVersion: 1,
      hostId: "host-primary",
      hostInstanceId: "instance-primary",
      serverTime: "2026-08-28T00:00:00.000Z",
      sessionAccessToken: `rah_host_session_${"b".repeat(32)}_primary`,
      sessionExpiresAt: "2026-08-28T00:01:00.000Z",
    };
  }

  async heartbeat(
    _token: string,
    request: ComputerHeartbeatRequest,
  ): Promise<ComputerHeartbeatResponse> {
    this.calls.push(`heartbeat:${request.state}`);
    return {
      host: {
        hostId: "host-primary",
        instanceId: "instance-primary",
        lastSeenAt: "2026-08-28T00:00:01.000Z",
        participantIds: ["agent-primary"],
        state: request.state,
      },
      serverTime: "2026-08-28T00:00:01.000Z",
      sessionExpiresAt: "2026-08-28T00:01:01.000Z",
    };
  }

  async publishRuntimeOffer(
    _token: string,
    _request: ComputerRuntimeOfferPublishRequest,
  ): Promise<ComputerRuntimeOfferPublishResponse> {
    throw new Error("fixture publishes no offers");
  }

  async claimPlacement(
    _token: string,
    _request: ComputerPlacementClaimRequest,
  ): Promise<ComputerPlacementClaimResponse> {
    this.calls.push("claim-placement");
    return { claim: null };
  }
}

async function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
