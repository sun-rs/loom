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
  ComputerAttachmentManager,
  ComputerControlClientError,
  FakeRuntimeAdapter,
  RemoteComputerManagedAttachmentService,
  type ComputerAttachment,
  type ComputerAttachmentStorePort,
  type ComputerControlClientPort,
  type ComputerManagedAttachmentServicePort,
} from "../src/index.ts";

function attachment(
  attachmentId: string,
  tokenCharacter = "a",
): ComputerAttachment {
  return {
    attachmentId,
    connectionId: `connection-${attachmentId}`,
    createdAt: "2026-08-28T00:00:00.000Z",
    hostAccessToken: `rah_host_${tokenCharacter.repeat(48)}`,
    origin: "https://control.example.test",
  };
}

class MemoryAttachmentStore implements ComputerAttachmentStorePort {
  records: ComputerAttachment[];

  constructor(records: ComputerAttachment[]) {
    this.records = records;
  }

  async read(): Promise<ComputerAttachment[]> {
    return this.records.map((record) => ({ ...record }));
  }
}

class FakeAttachmentClient implements ComputerControlClientPort {
  readonly calls: string[] = [];
  readonly computerInstanceIds: string[] = [];
  readonly id: string;
  revoked = false;
  participantIds: string[] = [];

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

  constructor(id: string) {
    this.id = id;
  }

  async openSession(
    request: ComputerSessionOpenRequest,
  ): Promise<ComputerSessionOpenResponse> {
    this.calls.push("open");
    this.computerInstanceIds.push(request.computerInstanceId);
    if (this.revoked) {
      throw new ComputerControlClientError(
        "unauthenticated",
        "fixture attachment revoked",
      );
    }
    return {
      acceptedControlApiVersion: 1,
      hostId: `host-${this.id}`,
      hostInstanceId: `instance-${this.id}`,
      serverTime: "2026-08-28T00:00:00.000Z",
      sessionAccessToken: `rah_host_session_${"b".repeat(32)}_${this.id}`,
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
        hostId: `host-${this.id}`,
        instanceId: `instance-${this.id}`,
        lastSeenAt: "2026-08-28T00:00:01.000Z",
        participantIds: [...this.participantIds],
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

function manager(input: {
  clients: FakeAttachmentClient[];
  store: MemoryAttachmentStore;
}): ComputerAttachmentManager {
  return new ComputerAttachmentManager({
    buildVersion: "attachment-manager-fixture/1.0.0",
    clientFactory: (record) => {
      const client = new FakeAttachmentClient(
        `${record.attachmentId}-${String(input.clients.length + 1)}`,
      );
      input.clients.push(client);
      return client;
    },
    runtimeOffers: async () => [],
    runtimeProtocolVersion: 1,
    store: input.store,
  });
}

test("attachment manager reconciles multiple attachments and only replaces changed records", async () => {
  const store = new MemoryAttachmentStore([
    attachment("primary"),
    attachment("secondary"),
  ]);
  const clients: FakeAttachmentClient[] = [];
  const resident = manager({ clients, store });
  assert.equal(resident.snapshot().state, "idle");

  const initial = await resident.reconcileOnce();
  assert.equal(initial.state, "idle");
  assert.equal(initial.attachments.primary?.state, "connected");
  assert.equal(initial.attachments.secondary?.state, "connected");
  assert.equal(clients.length, 2);

  await resident.reconcileOnce();
  assert.equal(clients.length, 2, "unchanged attachment reuses its session");

  store.records = [attachment("primary", "c")];
  const changed = await resident.reconcileOnce();
  assert.equal(clients.length, 3);
  assert.equal(changed.attachments.primary?.state, "connected");
  assert.equal(changed.attachments.secondary, undefined);
  assert.equal(clients[0]!.calls.at(-1), "heartbeat:offline");
  assert.equal(clients[1]!.calls.at(-1), "heartbeat:offline");

  await resident.stop();
  assert.equal(clients[2]!.calls.at(-1), "heartbeat:offline");
});

test("attachment manager shares one service incarnation across all attachments", async () => {
  const store = new MemoryAttachmentStore([
    attachment("primary"),
    attachment("secondary"),
  ]);
  const clients: FakeAttachmentClient[] = [];
  const manager = new ComputerAttachmentManager({
    buildVersion: "attachment-manager-fixture/1.0.0",
    clientFactory: (record) => {
      const client = new FakeAttachmentClient(record.attachmentId);
      clients.push(client);
      return client;
    },
    computerInstanceId: "shared-computer-incarnation",
    runtimeOffers: async () => [],
    runtimeProtocolVersion: 1,
    store,
  });

  await manager.reconcileOnce();
  assert.deepEqual(
    clients.flatMap((client) => client.computerInstanceIds),
    ["shared-computer-incarnation", "shared-computer-incarnation"],
  );
  await manager.stop();
});

test("a revoked attachment is parked without taking down healthy attachments", async () => {
  const store = new MemoryAttachmentStore([
    attachment("revoked"),
    attachment("healthy"),
  ]);
  const clients: FakeAttachmentClient[] = [];
  const resident = new ComputerAttachmentManager({
    buildVersion: "attachment-manager-fixture/1.0.0",
    clientFactory: (record) => {
      const client = new FakeAttachmentClient(record.attachmentId);
      client.revoked = record.attachmentId === "revoked";
      clients.push(client);
      return client;
    },
    runtimeOffers: async () => [],
    runtimeProtocolVersion: 1,
    store,
  });

  const result = await resident.reconcileOnce();
  assert.equal(result.attachments.revoked?.state, "degraded");
  assert.equal(
    result.attachments.revoked?.terminalReason,
    "attachment_revoked",
  );
  assert.equal(result.attachments.healthy?.state, "connected");

  await resident.reconcileOnce();
  assert.equal(
    clients[0]!.calls.filter((call) => call === "open").length,
    1,
    "terminal attachment remains parked until its stored revision changes",
  );
  await resident.stop();
});

test("a post-connect configuration terminal reports offline while preserving degraded diagnosis", async () => {
  const store = new MemoryAttachmentStore([attachment("misconfigured")]);
  const clients: FakeAttachmentClient[] = [];
  const resident = new ComputerAttachmentManager({
    buildVersion: "attachment-manager-fixture/1.0.0",
    clientFactory: (record) => {
      const client = new FakeAttachmentClient(record.attachmentId);
      clients.push(client);
      return client;
    },
    runtimeOffers: async () => {
      throw new Error("fixture Runtime Profile is invalid");
    },
    runtimeProtocolVersion: 1,
    store,
  });

  const result = await resident.reconcileOnce();
  assert.equal(result.attachments.misconfigured?.state, "degraded");
  assert.equal(
    result.attachments.misconfigured?.terminalReason,
    "configuration",
  );
  assert.match(
    result.attachments.misconfigured?.lastError ?? "",
    /Runtime Profile/u,
  );
  assert.equal(clients[0]!.calls.at(-1), "heartbeat:offline");
  await resident.stop();
});

test("attachment manager delegates each catalog entry to one injected lifecycle owner", async () => {
  const store = new MemoryAttachmentStore([attachment("primary")]);
  const clients: FakeAttachmentClient[] = [];
  const lifecycles: Array<{
    reconciles: number;
    service: ComputerManagedAttachmentServicePort;
    stops: number;
  }> = [];
  const manager = new ComputerAttachmentManager({
    buildVersion: "attachment-manager-fixture/1.0.0",
    clientFactory: (record) => {
      const client = new FakeAttachmentClient(record.attachmentId);
      clients.push(client);
      return client;
    },
    managedServiceFactory: ({ resident }) => {
      const lifecycle = {
        reconciles: 0,
        stops: 0,
        service: undefined as unknown as ComputerManagedAttachmentServicePort,
      };
      lifecycle.service = {
        reconcileOnce: async () => {
          lifecycle.reconciles += 1;
          return await resident.reconcileOnce();
        },
        snapshot: () => resident.snapshot(),
        stop: async () => {
          lifecycle.stops += 1;
          return await resident.stop();
        },
      };
      lifecycles.push(lifecycle);
      return lifecycle.service;
    },
    runtimeOffers: async () => [],
    runtimeProtocolVersion: 1,
    store,
  });

  await manager.reconcileOnce();
  assert.equal(lifecycles.length, 1);
  assert.equal(lifecycles[0]!.reconciles, 1);
  assert.equal(clients[0]!.calls.filter((call) => call === "open").length, 1);

  store.records = [];
  await manager.reconcileOnce();
  assert.equal(lifecycles[0]!.stops, 1);
  await manager.stop();
});

test("attachment manager can compose a bounded remote AgentHost per attachment", async () => {
  const store = new MemoryAttachmentStore([attachment("primary")]);
  const clients: FakeAttachmentClient[] = [];
  const manager = new ComputerAttachmentManager({
    buildVersion: "attachment-manager-fixture/1.0.0",
    clientFactory: (record) => {
      const client = new FakeAttachmentClient(record.attachmentId);
      client.participantIds = ["agent-primary"];
      clients.push(client);
      return client;
    },
    managedServiceFactory: ({ resident }) => {
      const runtime = new FakeRuntimeAdapter();
      return new RemoteComputerManagedAttachmentService({
        agentHost: {
          leaseMs: 30_000,
          placementRuntimeResolver: () => runtime,
          pollIntervalMs: 10,
          runtime,
        },
        capacity: 1,
        resident,
      });
    },
    runtimeOffers: async () => [],
    runtimeProtocolVersion: 1,
    store,
  });

  await manager.reconcileOnce();
  await waitFor(() => clients[0]!.calls.includes("claim-placement"));
  await manager.stop();
  assert.equal(clients[0]!.calls.at(-1), "heartbeat:offline");
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
