import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hostname } from "node:os";

import {
  RuntimeImplementationRegistry,
  RuntimeProfileRegistry,
} from "@rah-os/agent-host";
import { RoomKernel } from "@rah-os/kernel";
import type {
  ManagedMcpRuntimeAdapter,
  ToolAccessMode,
} from "@rah-os/protocol";
import { z } from "zod";

import { DaemonConfigSchema, type DaemonConfigV4 } from "./config.ts";
import { reconcileLocalWorkbenchRuntimeBindings } from "./local-workbench-runtime-bindings.ts";

const LocalWorkbenchMetadataSchema = z
  .object({
    bootstrapParticipantIds: z.array(z.string().min(1)).min(1),
    controlRoomId: z.string().min(1),
    defaultRoomId: z.string().min(1),
    hostId: z.string().min(1),
    schemaVersion: z.literal(1),
    workspaceCwd: z.string().min(1),
    workspaceId: z.string().min(1),
  })
  .strict();

export type LocalWorkbenchMetadata = z.infer<
  typeof LocalWorkbenchMetadataSchema
>;

export type LocalWorkbenchRuntimeSpec = {
  adapterKind:
    | "claude-stream-json/v1"
    | "codex-app-server/v1"
    | "generic-process/v1"
    | "kimi-acp/v1"
    | "opencode-server/v1";
  agentHandle: string;
  args: string[];
  avatarKey: string;
  cliId: string;
  description: string;
  displayName: string;
  executable: string;
  instructions: string;
  managedMcpAdapter?: ManagedMcpRuntimeAdapter;
  modelCatalogProbe?: {
    kind: "claude-cli/v1" | "codex-cli/v1" | "kimi-cli/v1" | "opencode-cli/v1";
  };
  reasoning: "default" | "low" | "medium" | "high";
  role: string;
  runtimeProfileId: string;
  toolAccessMode: ToolAccessMode;
  workspaceCwd: string;
};

export type PreparedLocalWorkbench = {
  config: DaemonConfigV4;
  hostAccessToken: string;
  hostSecretPath: string;
  humanAccessToken: string;
  humanSecretPath: string;
  metadata: LocalWorkbenchMetadata;
  registryDatabasePath: string;
};

export async function prepareLocalWorkbench(input: {
  runtimeSpecs: readonly LocalWorkbenchRuntimeSpec[];
  stateDirectory: string;
  workspaceCwd: string;
}): Promise<PreparedLocalWorkbench> {
  const stateDirectory = resolve(input.stateDirectory);
  const workspaceCwd = resolve(input.workspaceCwd);
  validateRuntimeSpecs(input.runtimeSpecs, workspaceCwd);
  assertWorkspaceDirectory(workspaceCwd);

  const initializedNow = !existsSync(stateDirectory);
  if (initializedNow) {
    await initializeState({
      runtimeSpecs: input.runtimeSpecs,
      stateDirectory,
      workspaceCwd,
    });
  }
  assertOwnerPrivateDirectory(stateDirectory);
  const metadata = readMetadata(stateDirectory);
  if (metadata.workspaceCwd !== workspaceCwd) {
    throw new Error(
      `local workbench belongs to workspace ${metadata.workspaceCwd}; received ${workspaceCwd}`,
    );
  }

  const humanSecretPath = join(stateDirectory, "human.token");
  const hostSecretPath = join(stateDirectory, "host.token");
  const humanAccessToken = readOwnerPrivateSecret(humanSecretPath);
  const hostAccessToken = readOwnerPrivateSecret(hostSecretPath);
  verifyCanonicalState({
    hostAccessToken,
    humanAccessToken,
    metadata,
    stateDirectory,
  });
  const registryDatabasePath = join(stateDirectory, "runtime-registry.db");
  // initializeState already imported, probed, and activated every runtime in
  // its atomic staging directory. Probe once again only on a later service
  // start, where executable identity/catalog refresh is intentional.
  if (!initializedNow) {
    await prepareRuntimeRegistry({
      hostId: metadata.hostId,
      registryDatabasePath,
      runtimeSpecs: input.runtimeSpecs,
      workspaceCwd,
    });
  }
  const runtimeOfferIds = reconcileLocalWorkbenchRuntimeBindings({
    humanAccessToken,
    metadata,
    registryDatabasePath,
    runtimeSpecs: input.runtimeSpecs,
    stateDirectory,
  });
  return {
    config: buildConfig({
      hostSecretPath,
      metadata,
      registryDatabasePath,
      runtimeSpecs: input.runtimeSpecs,
      runtimeOfferIds,
      stateDirectory,
      workspaceCwd,
    }),
    hostAccessToken,
    hostSecretPath,
    humanAccessToken,
    humanSecretPath,
    metadata,
    registryDatabasePath,
  };
}

async function initializeState(input: {
  runtimeSpecs: readonly LocalWorkbenchRuntimeSpec[];
  stateDirectory: string;
  workspaceCwd: string;
}): Promise<void> {
  const parentDirectory = dirname(input.stateDirectory);
  mkdirSync(parentDirectory, { mode: 0o700, recursive: true });
  const stagingDirectory = join(
    parentDirectory,
    `.rah-workbench-setup-${randomUUID()}`,
  );
  mkdirSync(stagingDirectory, { mode: 0o700 });
  chmodSync(stagingDirectory, 0o700);
  let kernel: RoomKernel | undefined;
  try {
    const databasePath = join(stagingDirectory, "room.db");
    kernel = new RoomKernel({ databasePath });
    kernel.initialize();
    const human = kernel.provisionPrincipal({
      handle: "owner",
      kind: "human",
    });
    const actor = kernel.authenticateHumanAccessToken(human.accessToken);
    const workspace = kernel.createWorkspace(actor, {
      idempotencyKey: "local-workbench-workspace-v1",
      name: hostname(),
      slug: "rah-local-workstation",
    });
    const defaultRoom = kernel.createWorkspaceRoom(actor, {
      basedOnControlRoomSeq: workspace.event.roomSeq,
      idempotencyKey: "local-workbench-default-room-v1",
      kind: "channel",
      name: "Agent Council",
      slug: "agent-council",
      workspaceId: workspace.workspace.workspaceId,
    });
    const participantIds: string[] = [];
    for (const [index, spec] of input.runtimeSpecs.entries()) {
      const agent = kernel.provisionPrincipal({
        handle: spec.agentHandle,
        kind: "agent",
      });
      participantIds.push(agent.principal.principalId);
      kernel.addMember(actor, {
        principalId: agent.principal.principalId,
        roomId: workspace.controlRoom.roomId,
      });
      const policy = kernel.createExecutionPolicy(actor, {
        basedOnRoomSeq: latestRoomSeq(
          kernel,
          actor,
          workspace.controlRoom.roomId,
        ),
        controlRoomId: workspace.controlRoom.roomId,
        idempotencyKey: `local-workbench-policy-${spec.cliId}-v1`,
        modelIntent: {
          fallback: "disabled",
          reasoning: spec.reasoning,
          serviceTier: "default",
        },
        preferred: [],
        required: {
          allowedOfferIds: [runtimeOfferId(spec.cliId)],
          allowedProtocolFamilies: ["rah-worker-process/v1"],
          capabilities: [],
          minimumIsolation: "none",
          workspaceMode: "in_place",
        },
        retryPolicyRef: contentRef(
          `local-workbench-retry-${spec.cliId}`,
          "retry-v1",
        ),
        sessionPolicy: "fresh",
        toolAccessMode: spec.toolAccessMode,
      }).policy;
      kernel.createAgentDefinition(actor, {
        avatarKey: spec.avatarKey,
        basedOnRoomSeq: latestRoomSeq(
          kernel,
          actor,
          workspace.controlRoom.roomId,
        ),
        controlRoomId: workspace.controlRoom.roomId,
        description: spec.description,
        displayName: spec.displayName,
        executionPolicyRevisionId: policy.executionPolicyRevisionId,
        idempotencyKey: `local-workbench-definition-${spec.cliId}-v1`,
        instructionRefs: [],
        instructions: spec.instructions,
        memoryPolicyRef: contentRef(
          `local-workbench-memory-${spec.cliId}`,
          "room-private-v1",
        ),
        participantId: agent.principal.principalId,
        role: spec.role,
        skillRefs: [],
      });
      if (index >= 63) {
        throw new Error("local workbench supports at most 64 runtimes");
      }
    }
    const hostId = `local-workbench-host-${randomUUID()}`;
    const host = kernel.provisionHostCredential({
      hostId,
      participantIds,
    });
    const metadata = LocalWorkbenchMetadataSchema.parse({
      bootstrapParticipantIds: participantIds,
      controlRoomId: workspace.controlRoom.roomId,
      defaultRoomId: defaultRoom.room.roomId,
      hostId,
      schemaVersion: 1,
      workspaceCwd: input.workspaceCwd,
      workspaceId: workspace.workspace.workspaceId,
    });
    writeSecret(join(stagingDirectory, "human.token"), human.accessToken);
    writeSecret(join(stagingDirectory, "host.token"), host.accessToken);
    writeFileSync(
      join(stagingDirectory, "workbench.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { mode: 0o600 },
    );
    kernel.close();
    kernel = undefined;
    await prepareRuntimeRegistry({
      hostId,
      registryDatabasePath: join(stagingDirectory, "runtime-registry.db"),
      runtimeSpecs: input.runtimeSpecs,
      workspaceCwd: input.workspaceCwd,
    });
    renameSync(stagingDirectory, input.stateDirectory);
  } catch (error) {
    try {
      kernel?.close();
    } catch {
      // Preserve the initialization failure.
    }
    rmSync(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}

async function prepareRuntimeRegistry(input: {
  hostId: string;
  registryDatabasePath: string;
  runtimeSpecs: readonly LocalWorkbenchRuntimeSpec[];
  workspaceCwd: string;
}): Promise<void> {
  const registry = new RuntimeProfileRegistry({
    databasePath: input.registryDatabasePath,
    hostId: input.hostId,
  });
  registry.initialize();
  const implementations = new RuntimeImplementationRegistry();
  try {
    for (const spec of input.runtimeSpecs) {
      const sharedManifest = {
        adapter: {
          config: {
            diagnosticByteLimit: 262_144,
            terminationGraceMs: 5_000,
          },
          executable: spec.executable,
          fixedArgs: spec.args,
          kind: spec.adapterKind,
        },
        credentialSlots: [],
        declaredCapabilities: ["worker_commands"],
        displayName: spec.displayName,
        ...(spec.managedMcpAdapter === undefined
          ? {}
          : { managedMcpAdapter: spec.managedMcpAdapter }),
        protocolFamily: "rah-worker-process/v1",
        recoveryDrivers:
          process.platform === "win32" ? [] : ["rah-process-supervisor-v1"],
        runtimeProfileId: spec.runtimeProfileId,
        staticEnv: {},
        workspacePolicy: { allowedModes: ["in_place"] },
      } as const;
      const revision = registry.importManifest(
        spec.modelCatalogProbe === undefined
          ? { ...sharedManifest, manifestVersion: 2 }
          : {
              ...sharedManifest,
              manifestVersion: 3,
              modelCatalogProbe: spec.modelCatalogProbe,
            },
      );
      const probe = registry.recordProbeReport(
        await implementations.probeRevision(revision, {
          cwd: input.workspaceCwd,
        }),
      );
      if (!probe.available) {
        throw new Error(
          `${spec.displayName} failed executable probe: ${probe.failureCode ?? "unavailable"}`,
        );
      }
      registry.activateRevision({
        contentDigest: revision.contentDigest,
        runtimeProfileRevisionId: revision.runtimeProfileRevisionId,
      });
    }
  } finally {
    registry.close();
  }
}

function buildConfig(input: {
  hostSecretPath: string;
  metadata: LocalWorkbenchMetadata;
  registryDatabasePath: string;
  runtimeSpecs: readonly LocalWorkbenchRuntimeSpec[];
  runtimeOfferIds: ReadonlyMap<string, string>;
  stateDirectory: string;
  workspaceCwd: string;
}): DaemonConfigV4 {
  const parsed = DaemonConfigSchema.parse({
    client: { bindHost: "127.0.0.1", port: 0 },
    drainTimeoutMs: 30_000,
    host: {
      credential: { path: input.hostSecretPath, source: "file" },
      hostId: input.metadata.hostId,
      maxConcurrent: input.runtimeSpecs.length,
      participantIds: input.metadata.bootstrapParticipantIds,
    },
    hostStaleAfterMs: 60_000,
    leaseMs: 60_000,
    leaseRenewIntervalMs: 20_000,
    outboxLeaseMs: 5_000,
    outboxPollIntervalMs: 100,
    outboxRetryAfterMs: 1_000,
    pollIntervalMs: 250,
    retryAfterMs: 5_000,
    runTimeoutMs: 30 * 60_000,
    runtimeCancelTimeoutMs: 20_000,
    runtimeRecoveryTimeoutMs: 60_000,
    runtimeStartTimeoutMs: 30_000,
    runtimes: input.runtimeSpecs.map((spec) => ({
      credentialBindings: {},
      kind: "runtime-profile-registry",
      offer: {
        leaseMs: 120_000,
        maxConcurrent: 1,
        refreshIntervalMs: 30_000,
        runtimeOfferId: input.runtimeOfferIds.get(spec.cliId),
      },
      registryDatabasePath: input.registryDatabasePath,
      runtimeProfileId: spec.runtimeProfileId,
    })),
    schemaVersion: 4,
    startupProbeMode: "reuse-latest",
    stateDirectory: input.stateDirectory,
    taskClaimHeartbeatIntervalMs: 5 * 60_000,
    taskClaimLeaseMs: 15 * 60_000,
    workspace: {
      cwd: input.workspaceCwd,
      mode: "in_place",
      workspaceDefinitionId: input.metadata.workspaceId,
      workspaceMountDigest: digest(`workspace:${input.workspaceCwd}`),
      workspaceMountRevisionId: `local-workbench-mount-${digestHex(input.workspaceCwd).slice(0, 16)}`,
    },
  });
  if (parsed.schemaVersion !== 4) {
    throw new Error("local workbench requires daemon config v4");
  }
  return parsed;
}

function verifyCanonicalState(input: {
  hostAccessToken: string;
  humanAccessToken: string;
  metadata: LocalWorkbenchMetadata;
  stateDirectory: string;
}): void {
  const kernel = new RoomKernel({
    databasePath: join(input.stateDirectory, "room.db"),
  });
  kernel.initialize();
  try {
    const actor = kernel.authenticateHumanAccessToken(input.humanAccessToken);
    const principal = kernel.getAuthenticatedPrincipal(actor);
    if (principal.kind !== "human") {
      throw new Error("local workbench Human credential is not a Human");
    }
    if (
      !kernel
        .listWorkspaces(actor)
        .some(
          (workspace) =>
            workspace.workspaceId === input.metadata.workspaceId &&
            workspace.controlRoomId === input.metadata.controlRoomId,
        )
    ) {
      throw new Error("local workbench canonical Workspace was not found");
    }
    if (
      !kernel
        .listRooms(actor, { workspaceId: input.metadata.workspaceId })
        .some((room) => room.roomId === input.metadata.defaultRoomId)
    ) {
      throw new Error("local workbench canonical default Room was not found");
    }
    const host = kernel.authenticateHostAccessToken(input.hostAccessToken);
    if (
      host.hostId !== input.metadata.hostId ||
      input.metadata.bootstrapParticipantIds.some(
        (participantId) => !host.participantIds.includes(participantId),
      )
    ) {
      throw new Error("local workbench Host credential scope is inconsistent");
    }
  } finally {
    kernel.close();
  }
}

function readMetadata(stateDirectory: string): LocalWorkbenchMetadata {
  const path = join(stateDirectory, "workbench.json");
  const serialized = readOwnerPrivateFile(path, 64 * 1_024);
  return LocalWorkbenchMetadataSchema.parse(JSON.parse(serialized) as unknown);
}

function readOwnerPrivateSecret(path: string): string {
  const value = readOwnerPrivateFile(path, 64 * 1_024).trim();
  if (value.length === 0) throw new Error(`secret file ${path} is empty`);
  return value;
}

function readOwnerPrivateFile(path: string, maximumBytes: number): string {
  const metadata = lstatSync(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${path} must be an owner-private regular file`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${path} must be owner-private`);
  }
  if (metadata.size > maximumBytes) {
    throw new Error(`${path} exceeds its safe byte limit`);
  }
  return readFileSync(path, "utf8");
}

function assertOwnerPrivateDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${path} must be an owner-private directory`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${path} must be owner-private`);
  }
}

function assertWorkspaceDirectory(path: string): void {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`workspace path ${path} must be a real directory`);
  }
}

function validateRuntimeSpecs(
  specs: readonly LocalWorkbenchRuntimeSpec[],
  workspaceCwd: string,
): void {
  if (specs.length === 0 || specs.length > 64) {
    throw new Error("local workbench requires between 1 and 64 runtimes");
  }
  for (const [field, values] of [
    ["cliId", specs.map((spec) => spec.cliId)],
    ["runtimeProfileId", specs.map((spec) => spec.runtimeProfileId)],
    ["agentHandle", specs.map((spec) => spec.agentHandle)],
  ] as const) {
    const normalized = values.map((value) => value.trim());
    if (normalized.some((value) => value.length === 0)) {
      throw new Error(`local workbench runtime ${field} is required`);
    }
    if (new Set(normalized).size !== normalized.length) {
      throw new Error(`local workbench runtime ${field} must be unique`);
    }
  }
  for (const spec of specs) {
    if (resolve(spec.workspaceCwd) !== workspaceCwd) {
      throw new Error(
        `runtime ${spec.cliId} belongs to workspace ${spec.workspaceCwd}`,
      );
    }
  }
}

function latestRoomSeq(
  kernel: RoomKernel,
  actor: ReturnType<RoomKernel["authenticateHumanAccessToken"]>,
  roomId: string,
): number {
  return kernel.sync(actor, {
    consumerId: `local-workbench-bootstrap-${roomId}`,
    roomId,
  }).latestRoomSeq;
}

function runtimeOfferId(cliId: string): string {
  return `local-workbench-offer-${cliId}`;
}

function contentRef(artifactId: string, versionId: string) {
  return {
    artifactId,
    contentDigest: digest(`${artifactId}:${versionId}`),
    versionId,
  };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${digestHex(value)}`;
}

function digestHex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeSecret(path: string, value: string): void {
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}
