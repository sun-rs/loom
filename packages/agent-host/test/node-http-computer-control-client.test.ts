import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";

import type {
  ComputerHeartbeatResponse,
  ComputerRuntimeOfferPublishResponse,
  ComputerSessionOpenResponse,
} from "@rah-os/computer-protocol";
import type { RuntimeCertification, RuntimeOffer } from "@rah-os/protocol";

import {
  ComputerControlClientError,
  ComputerResidentService,
  NodeHttpComputerControlClient,
} from "../src/index.ts";

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const sessionAccessToken = `rah_host_session_${"a".repeat(48)}`;
const certification: RuntimeCertification = {
  capabilities: ["worker_commands"],
  certificationDigest: digest("c"),
  certificationId: "certification-node-http",
  maximumIsolation: "process",
  protocolFamily: "rah-worker-process/v1",
  runtimeProfileDigest: digest("d"),
};

function runtimeOffer(): RuntimeOffer {
  return {
    capacityPoolIds: ["pool-node-http"],
    certificationRefs: [
      {
        certificationDigest: certification.certificationDigest,
        certificationId: certification.certificationId,
      },
    ],
    capabilityEvidence: [
      { capability: "worker_commands", evidence: "certified" },
    ],
    hostId: "host-node-http",
    hostInstanceId: "host-instance-node-http",
    isolation: { evidence: "certified", level: "process" },
    leaseUntil: "2026-08-28T00:01:00.000Z",
    maxConcurrent: 1,
    modelBindingDescriptors: [],
    observedAt: "2026-08-28T00:00:00.000Z",
    protocolFamily: "rah-worker-process/v1",
    revisionDigest: certification.runtimeProfileDigest,
    runtimeOfferId: "offer-node-http",
    runtimeProfileId: "profile-node-http",
    runtimeProfileRevisionId: "profile-node-http-v1",
    state: "available",
    workspaceMountDescriptors: [
      {
        modes: ["in_place"],
        workspaceDefinitionId: "workspace-node-http",
        workspaceMountDigest: digest("e"),
        workspaceMountRevisionId: "mount-node-http-v1",
      },
    ],
  };
}

function sessionResponse(): ComputerSessionOpenResponse {
  return {
    acceptedControlApiVersion: 1,
    hostId: "host-node-http",
    hostInstanceId: "host-instance-node-http",
    serverTime: "2026-08-28T00:00:00.000Z",
    sessionAccessToken,
    sessionExpiresAt: "2026-08-28T00:01:00.000Z",
  };
}

function heartbeatResponse(
  state: "draining" | "offline" | "online",
): ComputerHeartbeatResponse {
  return {
    host: {
      hostId: "host-node-http",
      instanceId: "host-instance-node-http",
      lastSeenAt: "2026-08-28T00:00:01.000Z",
      participantIds: [],
      state,
    },
    serverTime: "2026-08-28T00:00:01.000Z",
    sessionExpiresAt: "2026-08-28T00:01:01.000Z",
  };
}

function offerResponse(
  offer: RuntimeOffer,
): ComputerRuntimeOfferPublishResponse {
  return {
    offer: {
      ...offer,
      acceptedAt: "2026-08-28T00:00:01.000Z",
      resolvedCertifications: [certification],
      runtimeOfferObservationId: "observation-node-http",
      runtimeOfferSnapshotDigest: digest("f"),
    },
  };
}

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ close(): Promise<void>; origin: string }> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
    origin: `http://127.0.0.1:${String(address.port)}`,
  };
}

test("Node HTTP client drives a resident service through the narrow Computer API", async () => {
  const paths: string[] = [];
  const authorizations: string[] = [];
  const endpoint = await listen(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
    paths.push(request.url ?? "");
    authorizations.push(request.headers.authorization ?? "");
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/computer/session/open") {
      response.end(JSON.stringify(sessionResponse()));
    } else if (request.url === "/v1/computer/heartbeat") {
      response.end(
        JSON.stringify(heartbeatResponse(body.state as "offline" | "online")),
      );
    } else if (request.url === "/v1/computer/runtime-offers/publish") {
      const requestOffer = (body as { offer: RuntimeOffer }).offer;
      response.end(JSON.stringify(offerResponse(requestOffer)));
    } else if (request.url === "/v1/computer/operations/claim") {
      response.end(
        JSON.stringify({
          operation: {
            action: "restart",
            operationId: "operation-node-http",
            requestedAt: "2026-08-28T00:00:00.000Z",
          },
        }),
      );
    } else if (request.url === "/v1/computer/operations/acknowledge") {
      response.end(JSON.stringify({ accepted: true, terminal: false }));
    } else if (request.url === "/v1/computer/executions/command") {
      response.end(
        JSON.stringify({
          activation: {
            activationId: "activation-node-http",
            attemptCount: 1,
            createdAt: "2026-08-28T00:00:00.000Z",
            fromSeq: 1,
            leaseOwner: "host-node-http",
            leaseUntil: "2026-08-28T00:01:00.000Z",
            participantId: "agent-node-http",
            reason: "mention",
            roomId: "room-node-http",
            state: "leased",
            toSeq: 1,
            updatedAt: "2026-08-28T00:00:01.000Z",
          },
          kind: body.kind,
        }),
      );
    } else if (request.url === "/v1/computer/worker-credentials/issue") {
      response.end(
        JSON.stringify({
          credentialId: "worker-credential-node-http",
          expiresAt: "2026-08-28T00:05:00.000Z",
          workerAccessToken: `rah_wat_${"c".repeat(48)}`,
          workerApiOrigin: endpoint.origin,
        }),
      );
    } else if (request.url === "/v1/computer/worker-credentials/revoke") {
      response.end(JSON.stringify({ revoked: true }));
    } else {
      response.end(JSON.stringify({ claim: null }));
    }
  });
  try {
    const client = new NodeHttpComputerControlClient({
      hostAccessToken: `rah_host_${"b".repeat(48)}`,
      origin: endpoint.origin,
    });
    const resident = new ComputerResidentService({
      buildVersion: "node-http-fixture/1.0.0",
      client,
      connectionId: "node-http-stable-connection",
      runtimeOffers: async () => [runtimeOffer()],
      runtimeProtocolVersion: 1,
    });

    assert.equal((await resident.reconcileOnce()).state, "connected");
    assert.equal(
      (await resident.claimOperation({})).operation?.operationId,
      "operation-node-http",
    );
    assert.deepEqual(
      await resident.acknowledgeOperation({
        kind: "operation.progress",
        operationId: "operation-node-http",
        phase: "draining",
      }),
      { accepted: true, terminal: false },
    );
    assert.deepEqual(
      await client.claimPlacement(sessionAccessToken, { leaseMs: 30_000 }),
      {
        claim: null,
      },
    );
    assert.equal(
      (
        await client.commandExecution(sessionAccessToken, {
          activationId: "activation-node-http",
          kind: "activation.renew",
          leaseMs: 30_000,
        })
      ).kind,
      "activation.renew",
    );
    const workerCredential = await client.issueWorkerCredential(
      sessionAccessToken,
      {
        activationId: "activation-node-http",
        consumerId: "host-node-http:runtime",
        participantId: "agent-node-http",
        roomId: "room-node-http",
        runAttemptId: "run-node-http",
        toSeq: 1,
      },
    );
    assert.equal(
      (
        await client.revokeWorkerCredential(sessionAccessToken, {
          credentialId: workerCredential.credentialId,
        })
      ).revoked,
      true,
    );
    assert.equal((await resident.stop()).state, "stopped");
    assert.deepEqual(paths, [
      "/v1/computer/session/open",
      "/v1/computer/heartbeat",
      "/v1/computer/runtime-offers/publish",
      "/v1/computer/operations/claim",
      "/v1/computer/operations/acknowledge",
      "/v1/computer/placements/claim",
      "/v1/computer/executions/command",
      "/v1/computer/worker-credentials/issue",
      "/v1/computer/worker-credentials/revoke",
      "/v1/computer/heartbeat",
    ]);
    assert.match(authorizations[0]!, /^Bearer rah_host_b/u);
    assert.ok(
      authorizations
        .slice(1)
        .every((value) => value === `Bearer ${sessionAccessToken}`),
    );
  } finally {
    await endpoint.close();
  }
});

test("Node HTTP client classifies revoked credentials without exposing response bodies", async () => {
  const endpoint = await listen((_request, response) => {
    response.statusCode = 401;
    response.setHeader("content-type", "text/plain");
    response.end(`malformed secret body ${sessionAccessToken}`);
  });
  try {
    const client = new NodeHttpComputerControlClient({
      hostAccessToken: `rah_host_${"b".repeat(48)}`,
      origin: endpoint.origin,
    });
    await assert.rejects(
      client.openSession({
        capabilities: [
          "placement_pull",
          "runtime_activity_publish",
          "runtime_offer_publish",
          "terminal_proof",
          "worker_credential_issue",
        ],
        computerBuildVersion: "node-http-fixture/1.0.0",
        computerInstanceId: "node-http-revoked-boot",
        connectionId: "node-http-revoked",
        controlApiVersions: [1],
        processId: process.pid,
        runtimeProtocolVersion: 1,
      }),
      (error: unknown) =>
        error instanceof ComputerControlClientError &&
        error.kind === "unauthenticated" &&
        !error.message.includes(sessionAccessToken),
    );
  } finally {
    await endpoint.close();
  }
});

test("Node HTTP client rejects cleartext non-loopback control origins", () => {
  assert.throws(
    () =>
      new NodeHttpComputerControlClient({
        hostAccessToken: `rah_host_${"b".repeat(48)}`,
        origin: "http://192.0.2.10:4174",
      }),
    /HTTPS/u,
  );
});

test("Node HTTP client bounds untrusted response bodies before JSON parsing", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      cancel: () => {
        cancelled = true;
      },
      pull: (controller) => {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new Uint8Array(256 * 1_024 + 1));
        } else {
          controller.error(new Error("client read beyond the declared limit"));
        }
      },
    },
    { highWaterMark: 0 },
  );
  const client = new NodeHttpComputerControlClient({
    fetch: (async () => new Response(body)) as typeof fetch,
    hostAccessToken: `rah_host_${"b".repeat(48)}`,
    origin: "http://127.0.0.1:4174",
  });
  await assert.rejects(
    client.openSession({
      capabilities: [
        "placement_pull",
        "runtime_activity_publish",
        "runtime_offer_publish",
        "terminal_proof",
        "worker_credential_issue",
      ],
      computerBuildVersion: "node-http-fixture/1.0.0",
      computerInstanceId: "node-http-oversized-boot",
      connectionId: "node-http-oversized",
      controlApiVersions: [1],
      processId: process.pid,
      runtimeProtocolVersion: 1,
    }),
    (error: unknown) =>
      error instanceof ComputerControlClientError &&
      error.kind === "protocol" &&
      /256 KiB/u.test(error.message),
  );
  assert.ok(pulls <= 2, "reader must stop at the first oversized chunk");
  assert.equal(cancelled, true);
});
