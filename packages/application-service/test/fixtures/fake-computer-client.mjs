const required = (name) => {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

const origin = required("RAH_COMPUTER_ORIGIN");
const hostAccessToken = required("RAH_HOST_ACCESS_TOKEN");
const connectionId = required("RAH_CONNECTION_ID");
const runtimeOfferId = required("RAH_RUNTIME_OFFER_ID");
const certificationId = required("RAH_CERTIFICATION_ID");
const certificationDigest = required("RAH_CERTIFICATION_DIGEST");
const runtimeProfileDigest = required("RAH_RUNTIME_PROFILE_DIGEST");
const workspaceMountDigest = required("RAH_WORKSPACE_MOUNT_DIGEST");

class HttpResponseError extends Error {
  constructor(path, status) {
    super(`${path} failed with ${String(status)}`);
    this.status = status;
  }
}

async function post(path, accessToken, body) {
  const response = await fetch(`${origin}${path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const value = await response.json();
  if (!response.ok) {
    throw new HttpResponseError(path, response.status);
  }
  return value;
}

const session = await post("/v1/computer/session/open", hostAccessToken, {
  capabilities: [
    "placement_pull",
    "runtime_activity_publish",
    "runtime_offer_publish",
    "terminal_proof",
    "worker_credential_issue",
  ],
  computerBuildVersion: "fake-computer/1.0.0",
  computerInstanceId: `${connectionId}-boot`,
  connectionId,
  controlApiVersions: [1],
  processId: process.pid,
  runtimeProtocolVersion: 1,
});
const observedAt = new Date();
await post("/v1/computer/runtime-offers/publish", session.sessionAccessToken, {
  offer: {
    capacityPoolIds: [`pool-${runtimeOfferId}`],
    certificationRefs: [{ certificationDigest, certificationId }],
    capabilityEvidence: [
      { capability: "worker_commands", evidence: "certified" },
    ],
    hostId: session.hostId,
    hostInstanceId: session.hostInstanceId,
    isolation: { evidence: "certified", level: "process" },
    leaseUntil: new Date(observedAt.getTime() + 60_000).toISOString(),
    maxConcurrent: 1,
    modelBindingDescriptors: [],
    observedAt: observedAt.toISOString(),
    protocolFamily: "rah-worker-process/v1",
    revisionDigest: runtimeProfileDigest,
    runtimeOfferId,
    runtimeProfileId: `profile-${runtimeOfferId}`,
    runtimeProfileRevisionId: `profile-${runtimeOfferId}-v1`,
    state: "available",
    workspaceMountDescriptors: [
      {
        modes: ["in_place"],
        workspaceDefinitionId: "workspace-http-fixture",
        workspaceMountDigest,
        workspaceMountRevisionId: `mount-${runtimeOfferId}-v1`,
      },
    ],
  },
});

process.stdout.write(
  `RAH_FAKE_COMPUTER_READY ${JSON.stringify({
    hostId: session.hostId,
    hostInstanceId: session.hostInstanceId,
  })}\n`,
);

process.stdin.setEncoding("utf8");
let pending = "";
commands: for await (const chunk of process.stdin) {
  pending += chunk;
  let newline = pending.indexOf("\n");
  while (newline >= 0) {
    const command = pending.slice(0, newline).trim();
    pending = pending.slice(newline + 1);
    try {
      if (command === "offline" || command === "heartbeat") {
        const result = await post(
          "/v1/computer/heartbeat",
          session.sessionAccessToken,
          { state: command === "offline" ? "offline" : "online" },
        );
        process.stdout.write(
          `RAH_FAKE_COMPUTER_${command.toUpperCase()} ${JSON.stringify({
            hostId: result.host.hostId,
            hostInstanceId: result.host.instanceId,
          })}\n`,
        );
      } else if (command === "claim") {
        const result = await post(
          "/v1/computer/placements/claim",
          session.sessionAccessToken,
          { leaseMs: 30_000 },
        );
        if (result.claim === null) {
          throw new Error("no Placement was available");
        }
        const runtimeRunId = `runtime-${result.claim.runAttempt.runAttemptId}`;
        const recoveryDescriptor = {
          driver: "fake-computer/v1",
          metadata: {},
          recoveryKey: runtimeRunId,
        };
        await post(
          "/v1/computer/executions/command",
          session.sessionAccessToken,
          {
            kind: "runtime.prepare",
            recoveryDescriptor,
            runAttemptId: result.claim.runAttempt.runAttemptId,
            runtimeRunId,
          },
        );
        await post(
          "/v1/computer/executions/command",
          session.sessionAccessToken,
          {
            kind: "run.start",
            recoveryDescriptor,
            runAttemptId: result.claim.runAttempt.runAttemptId,
            runtimeRunId,
          },
        );
        await post(
          "/v1/computer/executions/command",
          session.sessionAccessToken,
          {
            activationId: result.claim.activation.activationId,
            kind: "activation.renew",
            leaseMs: 30_000,
          },
        );
        await post(
          "/v1/computer/executions/command",
          session.sessionAccessToken,
          {
            exit: { code: 0 },
            kind: "runtime.terminate",
            runAttemptId: result.claim.runAttempt.runAttemptId,
            runtimeRunId,
          },
        );
        const finished = await post(
          "/v1/computer/executions/command",
          session.sessionAccessToken,
          {
            kind: "run.finish",
            runAttemptId: result.claim.runAttempt.runAttemptId,
            state: "exited",
          },
        );
        const retried = await post(
          "/v1/computer/executions/command",
          session.sessionAccessToken,
          {
            activationId: result.claim.activation.activationId,
            error: "fake Computer completed transport proof",
            kind: "activation.retry",
            retryAfterMs: 1_000,
          },
        );
        process.stdout.write(
          `RAH_FAKE_COMPUTER_CLAIM ${JSON.stringify({
            activationState: retried.activation.state,
            hostId: result.claim.placement.hostId,
            participantId: result.claim.placement.participantId,
            placementId: result.claim.placement.placementId,
            runAttemptId: result.claim.runAttempt.runAttemptId,
            runState: finished.runAttempt.state,
          })}\n`,
        );
        break commands;
      }
    } catch (error) {
      process.stdout.write(
        `RAH_FAKE_COMPUTER_ERROR ${JSON.stringify({
          command,
          status: error instanceof HttpResponseError ? error.status : 500,
        })}\n`,
      );
    }
    newline = pending.indexOf("\n");
  }
}
