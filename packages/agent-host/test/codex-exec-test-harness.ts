import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { WorkerApplicationService } from "@rah-os/application-service";
import { RoomKernel } from "@rah-os/kernel";
import {
  AgentHost,
  ProviderSessionStore,
  RuntimeProfileRegistry,
  RuntimeImplementationRegistry,
  createWorkerToolTransportEnvironment,
  type ActivationEnvelope,
  type RuntimeAdapter,
} from "../src/index.ts";
import { createCodexExecRuntime } from "../src/codex-exec-runtime.ts";

export async function codexExecHarness(
  options: {
    nativeFinalText?: boolean;
    executable?: string;
    modelBindingId?: string;
    env?: Record<string, string>;
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "loom-exec-integration-"));
  chmodSync(directory, 0o700);
  const databasePath = join(directory, "room.db");
  const kernel = new RoomKernel({ databasePath });
  kernel.initialize();
  const worker = new WorkerApplicationService({ kernel });
  await worker.start();
  const human = kernel.provisionPrincipal({
    handle: "exec-human",
    kind: "human",
  });
  const agent = kernel.provisionPrincipal({
    handle: "exec-instance",
    kind: "agent",
  });
  const participantId = agent.principal.principalId;
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const room = kernel.createRoom(actor, { name: "Exec", slug: "exec" });
  kernel.addMember(actor, { principalId: participantId, roomId: room.roomId });
  const host = kernel.authenticateHostAccessToken(
    kernel.provisionHostCredential({
      hostId: "exec-host",
      participantIds: [participantId],
    }).accessToken,
  );
  kernel.heartbeatHost(host);
  const fakePath = fileURLToPath(
    new URL("./fixtures/fake-codex-exec.mjs", import.meta.url),
  );
  const executable = join(directory, "codex");
  writeFileSync(
    executable,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(fakePath)} "$@"\n`,
    { mode: 0o700 },
  );
  const profiles = new RuntimeProfileRegistry({
    databasePath: join(directory, "profiles.db"),
    hostId: "exec-host",
  });
  profiles.initialize();
  const revision = profiles.importManifest({
    adapter: {
      config: { diagnosticByteLimit: 262144, terminationGraceMs: 500 },
      executable: options.executable ?? executable,
      fixedArgs: [],
      kind: "codex-exec/v1",
    },
    credentialSlots: [],
    declaredCapabilities: ["worker_commands"],
    displayName: "FAKE ordinary Codex",
    manifestVersion: 3,
    modelCatalogProbe: { kind: "codex-cli/v1" },
    protocolFamily: "rah-worker-process/v1",
    recoveryDrivers: ["rah-process-supervisor-v1"],
    runtimeProfileId: "fake-ordinary-codex",
    staticEnv: {},
    workspacePolicy: { allowedModes: ["in_place"] },
  });
  const report = profiles.recordProbeReport(
    await new RuntimeImplementationRegistry().probeRevision(revision, {
      cwd: directory,
    }),
  );
  const modelBinding =
    report.reportVersion !== 2
      ? undefined
      : options.modelBindingId === undefined
        ? report.modelBindings[0]
        : report.modelBindings.find(
            (binding) => binding.modelBindingId === options.modelBindingId,
          );
  if (!modelBinding) {
    await worker.close();
    profiles.close();
    kernel.close();
    rmSync(directory, { force: true, recursive: true });
    throw new Error(
      "Requested Codex catalog binding unavailable; no fallback selected",
    );
  }
  const recordPath = join(directory, "records.jsonl");
  const codeHome = join(directory, "codex-home");
  const credentialEvents: string[] = [];
  const credentials: string[] = [];
  const runtime = createCodexExecRuntime(
    revision,
    {
      cwd: directory,
      nativeFinalText: options.nativeFinalText ?? true,
      supervisorDirectory: join(directory, "supervisors"),
      providerSessionStore: new ProviderSessionStore({
        rootDirectory: join(directory, "provider-sessions"),
      }),
      recordDeliveryAcceptance: (input) => {
        kernel.markPresentedDeliverySent(host, {
          activationId: input.activationId,
          consumerId: input.consumerId,
          runAttemptId: input.runAttemptId,
        });
      },
      activationEnvironment: async (input) => {
        const credential = worker.issueActivationCredential(host, input);
        credentials.push(credential.accessToken);
        credentialEvents.push("issued");
        const lease = await createWorkerToolTransportEnvironment({
          credentialDirectory: join(directory, "credentials"),
          revokeCredential: () => {
            credentialEvents.push("revoked");
            credential.revoke();
          },
          workerAccessToken: credential.accessToken,
          workerApiOrigin: worker.origin,
        });
        return {
          ...lease,
          args: ["--prompt", "FAKE ordinary Codex integration standing prompt"],
          env: {
            ...lease.env,
            CODEX_HOME: codeHome,
            FAKE_CODEX_EXEC_RECORD_PATH: recordPath,
            ...options.env,
          },
          standingPromptDigest: "fake-codex-exec-standing",
        };
      },
    },
    report,
    {
      source: "explicit_binding",
      modelBindingId: modelBinding.modelBindingId,
      provider: modelBinding.provider,
      modelId: modelBinding.modelId,
      reasoning: "low",
    },
    "full_access",
  );
  // Fixture placement only: AgentHost/Worker identities and durable state remain real.
  const transport: RuntimeAdapter = {
    guideRuntimeId: "codex",
    probe: () => runtime.probe(),
    start: (input, lifecycle) =>
      runtime.start({ ...input, contextManifest: context(input) }, lifecycle),
    cancel: (run) => runtime.cancel(run),
    reap: (run) => runtime.reap(run),
    recover: (input) => runtime.recover(input),
    isAlive: (run) => runtime.isAlive(run),
  };
  const agentHost = new AgentHost({
    host,
    kernel,
    leaseMs: 30000,
    drainTimeoutMs: 300,
    pollIntervalMs: 20,
    retryAfterMs: 0,
    runtime: transport,
  });
  function context(input: ActivationEnvelope) {
    return {
      activationId: input.activationId,
      agentDefinition: {
        agentDefinitionRevisionId: "fake-definition",
        contentDigest: `sha256:${"a".repeat(64)}` as const,
        instructionRefs: [],
        memoryPolicyRef: {
          artifactId: "fake-memory",
          contentDigest: `sha256:${"b".repeat(64)}` as const,
          versionId: "v1",
        },
        skillRefs: [],
      },
      contentDigest: `sha256:${"c".repeat(64)}` as const,
      contextManifestId: `context-${input.runAttemptId}`,
      createdAt: new Date().toISOString(),
      eventRanges: [{ fromSeq: input.fromSeq, toSeq: input.toSeq }],
      participantId,
      placement: {
        placementId: "fake-placement",
        runtimeProfileDigest: revision.contentDigest,
        runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
        workspaceDefinitionId: "fake-workspace",
        workspaceMode: "in_place" as const,
        workspaceMountDigest: `sha256:${"d".repeat(64)}` as const,
        workspaceMountRevisionId: "fake-workspace-v1",
      },
      roomId: room.roomId,
      runAttemptId: input.runAttemptId,
      schemaVersion: 1 as const,
      throughRoomSeq: input.toSeq,
    };
  }
  let posts = 0;
  return {
    agentHost,
    revision,
    profiles,
    actor,
    kernel,
    participantId,
    roomId: room.roomId,
    databasePath,
    directory,
    codeHome,
    credentialEvents,
    credentials,
    workerOrigin: worker.origin,
    runtime,
    post(body: string) {
      return kernel.postMessage(actor, {
        body,
        idempotencyKey: `post-${++posts}`,
        recipients: [{ participantId, reason: "mention" }],
        roomId: room.roomId,
      });
    },
    records(): Record<string, unknown>[] {
      return existsSync(recordPath)
        ? readFileSync(recordPath, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [];
    },
    async cleanup() {
      await worker.close();
      profiles.close();
      kernel.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}
export type CodexExecHarness = Awaited<ReturnType<typeof codexExecHarness>>;
export function sql(
  state: CodexExecHarness,
  query: string,
  ...values: string[]
) {
  const db = new DatabaseSync(state.databasePath, { readOnly: true });
  try {
    return db.prepare(query).all(...values) as Record<string, unknown>[];
  } finally {
    db.close();
  }
}
export async function waitFor(probe: () => boolean, label: string) {
  const end = Date.now() + 10000;
  while (!probe()) {
    if (Date.now() > end) throw Error(`Timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
