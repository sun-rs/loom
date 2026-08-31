import { createHash, randomUUID } from "node:crypto";
import {
  listAgentWorkspace,
  readAgentWorkspace,
} from "./agent-workspace-browser.ts";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type {
  AgentMemoryWorkspaceSnapshot,
  AgentMemoryMaterializedFile,
  AgentRuntimeContext,
  AgentMemoryConfigPatch,
  AgentMemoryConfigSnapshot,
} from "@rah-os/protocol";
import { AgentMemoryConfigStore } from "./agent-memory-config-store.ts";

import {
  AgentMemoryCleanerRuntime,
  type AgentMemoryCleanerConfig,
  type AgentMemorySizeHint,
} from "./agent-memory-cleaner.ts";
import {
  agentMemoryWorkspacePath,
  prepareAgentMemoryWorkspace,
  RAH_AGENT_APP_INBOX_JSON_ENV,
} from "./agent-memory-workspace.ts";
import {
  inspectAgentMemoryWorkspace,
  readAgentMemoryWorkspaceFile,
  type AgentMemoryMaterializationIdentity,
} from "./agent-memory-materialization.ts";
import {
  prepareAgentMemoryRun,
  type PreparedAgentMemoryActivation,
} from "./agent-memory-activation.ts";
import { createAgentAppInboxEnvironment } from "./agent-app-inbox-transport.ts";
import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";
export type { PreparedAgentMemoryActivation } from "./agent-memory-activation.ts";

export type AgentMemoryResetFence = Readonly<{
  release(): Promise<void> | void;
}>;

export type AgentMemoryResetReceipt =
  | Readonly<{
      kind: "already_absent";
      deduplicated: boolean;
      operationId: string;
      ownerParticipantId: string;
      providerContinuityRecords: number;
      resetAtMs: number;
    }>
  | Readonly<{
      kind: "quarantined";
      deduplicated: boolean;
      operationId: string;
      ownerParticipantId: string;
      providerContinuityRecords: number;
      quarantinePath: string;
      resetAtMs: number;
    }>;

export type AgentMemoryProviderContinuityQuarantine = Readonly<{
  recordCount: number;
  rollback(): Promise<void> | void;
}>;

/**
 * Computer-owned integration for the authorized Raft memory workspace and
 * cleaner contracts. Typed App Inbox state stays outside the Room ledger and
 * is exposed only to the matching Agent's real Activation environment.
 */
export class AgentMemoryCoordinator {
  readonly #inboxLeases = new Set<ActivationEnvironmentLease>();
  #closed = false;
  readonly #acquireResetFence:
    | ((
        ownerParticipantId: string,
        operationId: string,
      ) => Promise<AgentMemoryResetFence | null>)
    | undefined;
  readonly #cleaner: AgentMemoryCleanerRuntime;
  readonly #quarantineProviderContinuity:
    | ((
        ownerParticipantId: string,
        operationId: string,
      ) => Promise<AgentMemoryProviderContinuityQuarantine>)
    | undefined;
  readonly #now: () => number;
  readonly #rootDirectory: string;
  readonly #configs: AgentMemoryConfigStore;
  readonly #resetting = new Set<string>();

  constructor(options: {
    acquireResetFence?: (
      ownerParticipantId: string,
      operationId: string,
    ) => Promise<AgentMemoryResetFence | null>;
    quarantineProviderContinuity?: (
      ownerParticipantId: string,
      operationId: string,
    ) => Promise<AgentMemoryProviderContinuityQuarantine>;
    now?: () => number;
    rootDirectory: string;
    wake: (
      ownerParticipantId: string,
      item: AgentMemorySizeHint,
      signal: AbortSignal,
    ) => Promise<boolean> | boolean;
  }) {
    if (!isAbsolute(options.rootDirectory)) {
      throw new Error("Agent memory coordinator root must be absolute");
    }
    this.#acquireResetFence = options.acquireResetFence;
    this.#quarantineProviderContinuity = options.quarantineProviderContinuity;
    this.#now = options.now ?? Date.now;
    this.#rootDirectory = resolve(options.rootDirectory);
    this.#configs = new AgentMemoryConfigStore(this.#rootDirectory);
    this.#cleaner = new AgentMemoryCleanerRuntime({ wake: options.wake });
  }

  async close(): Promise<void> {
    this.#closed = true;
    const outcomes = await Promise.allSettled([
      this.#cleaner.close(),
      ...[...this.#inboxLeases].map((lease) => lease.release?.()),
    ]);
    const errors = outcomes.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0)
      throw new AggregateError(errors, "Agent Memory close failed");
  }

  listHints(ownerParticipantId: string): AgentMemorySizeHint[] {
    return this.#cleaner.listHints(ownerParticipantId);
  }

  getCleanerConfig(ownerParticipantId: string): AgentMemoryConfigSnapshot {
    if (this.#closed) throw new Error("Agent Memory coordinator is closed");
    return this.#configs.get(requireParticipantId(ownerParticipantId));
  }

  patchCleanerConfig(
    ownerParticipantId: string,
    patch: AgentMemoryConfigPatch,
  ): AgentMemoryConfigSnapshot {
    if (this.#closed) throw new Error("Agent Memory coordinator is closed");
    const config = this.#configs.patch(
      requireParticipantId(ownerParticipantId),
      patch,
    );
    const applied = this.#cleaner.getAppliedConfig(ownerParticipantId);
    if (applied && !this.#resetting.has(ownerParticipantId)) {
      this.#cleaner.applyConfig(cleanerConfig(config, applied.memoryIndexPath));
    }
    return config;
  }

  checkInbox(ownerParticipantId: string) {
    return this.#cleaner.checkInbox(ownerParticipantId);
  }

  recheckInbox(ownerParticipantId: string) {
    return this.#cleaner.recheckInbox(ownerParticipantId);
  }

  acknowledgeHint(ownerParticipantId: string, itemId: string, version: number) {
    return this.#cleaner.acknowledgeHint(ownerParticipantId, itemId, version);
  }

  /** Runtime-only lease: materialization itself need not create credentials. */
  async prepareRuntimeActivation(
    agent: AgentRuntimeContext,
    activation: AgentMemoryMaterializationIdentity,
    execution?: { cwd: string },
  ): Promise<PreparedAgentMemoryActivation & ActivationEnvironmentLease> {
    if (this.#closed) throw new Error("Agent Memory coordinator is closed");
    const prepared = await this.prepareActivation(agent, activation, execution);
    const transport = await createAgentAppInboxEnvironment({
      credentialDirectory: join(this.#rootDirectory, ".app-inbox-credentials"),
      ownerParticipantId: agent.participantId,
      port: this,
    });
    if (this.#closed) {
      await transport.release?.();
      throw new Error("Agent Memory coordinator is closed");
    }
    const lease = Object.freeze({
      ...prepared,
      env: Object.freeze({ ...prepared.env, ...transport.env }),
      ...(transport.redactions === undefined
        ? {}
        : { redactions: transport.redactions }),
      release: async () => {
        try {
          await transport.release?.();
        } finally {
          this.#inboxLeases.delete(lease);
        }
      },
    });
    this.#inboxLeases.add(lease);
    return lease;
  }

  async browseWorkspace(owner: string, path: string, includeHidden: boolean) {
    return listAgentWorkspace(
      this.#rootDirectory,
      requireParticipantId(owner),
      path,
      includeHidden,
    );
  }

  async previewWorkspaceFile(owner: string, path: string) {
    return readAgentWorkspace(
      this.#rootDirectory,
      requireParticipantId(owner),
      path,
    );
  }

  async inspectWorkspace(
    ownerParticipantId: string,
  ): Promise<AgentMemoryWorkspaceSnapshot> {
    const workspace = await inspectAgentMemoryWorkspace({
      ownerParticipantId: requireParticipantId(ownerParticipantId),
      rootDirectory: this.#rootDirectory,
    });
    const thresholdBytes =
      this.getCleanerConfig(ownerParticipantId).effective.threshold_bytes;
    return {
      ...workspace,
      thresholdBytes,
      ...(workspace.state === "ready"
        ? {
            indexOverThreshold: workspace.files[0]!.bytes > thresholdBytes,
          }
        : {}),
    };
  }

  async readWorkspaceFile(
    ownerParticipantId: string,
    relativePath: string,
  ): Promise<
    Readonly<{
      content: string;
      file: AgentMemoryMaterializedFile;
      ownerParticipantId: string;
    }>
  > {
    return await readAgentMemoryWorkspaceFile({
      ownerParticipantId: requireParticipantId(ownerParticipantId),
      relativePath,
      rootDirectory: this.#rootDirectory,
    });
  }

  async prepareActivation(
    agent: AgentRuntimeContext,
    activation: AgentMemoryMaterializationIdentity,
    execution?: Readonly<{ cwd: string }>,
  ): Promise<PreparedAgentMemoryActivation> {
    if (this.#closed) throw new Error("Agent Memory coordinator is closed");
    if (this.#resetting.has(agent.participantId))
      throw new Error("Agent memory reset in progress");
    const prepared = await prepareAgentMemoryWorkspace({
      agent,
      rootDirectory: this.#rootDirectory,
    });
    if (this.#closed) throw new Error("Agent Memory coordinator is closed");
    if (this.#resetting.has(agent.participantId))
      throw new Error("Agent memory reset in progress");
    const config = cleanerConfig(
      this.getCleanerConfig(agent.participantId),
      prepared.memoryIndexPath,
    );
    this.#cleaner.applyConfig(config);
    await this.#cleaner.runNow(agent.participantId);
    const hints = this.#cleaner.listHints(agent.participantId);
    const activationMemory = await prepareAgentMemoryRun({
      activation,
      agent,
      ...(execution === undefined ? {} : { executionCwd: execution.cwd }),
      now: this.#now,
      prepared,
      rootDirectory: this.#rootDirectory,
    });
    return Object.freeze({
      ...activationMemory,
      env: Object.freeze({
        ...activationMemory.env,
        ...(hints.length === 0
          ? {}
          : { [RAH_AGENT_APP_INBOX_JSON_ENV]: JSON.stringify(hints) }),
      }),
    });
  }

  async resetWorkspace(
    ownerParticipantId: string,
    idempotencyKey?: string,
  ): Promise<AgentMemoryResetReceipt> {
    const participantId = requireParticipantId(ownerParticipantId);
    const operationId =
      idempotencyKey === undefined
        ? randomUUID()
        : resetOperationId(
            participantId,
            requireIdempotencyKey(idempotencyKey),
          );
    const priorReceipt = await readResetReceipt(
      this.#rootDirectory,
      operationId,
    );
    if (priorReceipt !== null) {
      if (priorReceipt.ownerParticipantId !== participantId) {
        throw new Error("Agent memory reset receipt owner mismatch");
      }
      return Object.freeze({ ...priorReceipt, deduplicated: true });
    }
    const acquire = this.#acquireResetFence;
    if (acquire === undefined) {
      throw new Error(
        "Agent memory reset requires an exclusive terminal fence",
      );
    }
    const quarantineProviderContinuity = this.#quarantineProviderContinuity;
    if (quarantineProviderContinuity === undefined) {
      throw new Error(
        "Agent memory reset requires rollback-capable Provider continuity quarantine",
      );
    }
    const fence = await acquire(participantId, operationId);
    if (fence === null) {
      throw new Error(
        "Agent memory reset could not acquire an exclusive terminal fence",
      );
    }
    const previousConfig = this.#cleaner.getAppliedConfig(participantId);
    this.#resetting.add(participantId);
    this.#cleaner.removeConfig(participantId);
    let movedFrom: string | undefined;
    let movedTo: string | undefined;
    let providerContinuity: AgentMemoryProviderContinuityQuarantine | undefined;
    let safeToReleaseFence = false;
    try {
      await ensurePrivateDirectory(this.#rootDirectory, "Agent memory root");
      const workspacePath = agentMemoryWorkspacePath(
        this.#rootDirectory,
        participantId,
      );
      const resetAtMs = safeEpoch(this.#now());
      if (await pathExists(workspacePath)) {
        await assertPrivateDirectory(workspacePath, "Agent memory workspace");
        const quarantineRoot = join(this.#rootDirectory, ".quarantine");
        await ensurePrivateDirectory(
          quarantineRoot,
          "Agent memory quarantine root",
        );
        movedFrom = workspacePath;
        movedTo = join(
          quarantineRoot,
          `${basename(workspacePath)}.${String(resetAtMs)}.${operationId}`,
        );
        await rename(movedFrom, movedTo);
        await syncDirectory(dirname(movedFrom));
      }
      providerContinuity = await quarantineProviderContinuity(
        participantId,
        operationId,
      );
      if (
        !Number.isSafeInteger(providerContinuity.recordCount) ||
        providerContinuity.recordCount < 0
      ) {
        throw new Error(
          "Provider continuity quarantine returned an invalid record count",
        );
      }
      const receipt: AgentMemoryResetReceipt =
        movedTo === undefined
          ? Object.freeze({
              kind: "already_absent" as const,
              deduplicated: false,
              operationId,
              ownerParticipantId: participantId,
              providerContinuityRecords: providerContinuity.recordCount,
              resetAtMs,
            })
          : Object.freeze({
              kind: "quarantined" as const,
              deduplicated: false,
              operationId,
              ownerParticipantId: participantId,
              providerContinuityRecords: providerContinuity.recordCount,
              quarantinePath: movedTo,
              resetAtMs,
            });
      await persistReceipt(this.#rootDirectory, receipt);
      safeToReleaseFence = true;
      return receipt;
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      if (providerContinuity !== undefined) {
        try {
          await providerContinuity.rollback();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (movedFrom !== undefined && movedTo !== undefined) {
        try {
          await rename(movedTo, movedFrom);
          await syncDirectory(dirname(movedFrom));
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (previousConfig !== null && !this.#closed) {
        try {
          this.#cleaner.applyConfig(
            cleanerConfig(
              this.getCleanerConfig(participantId),
              previousConfig.memoryIndexPath,
            ),
          );
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Agent memory reset failed and quarantine rollback failed",
        );
      }
      safeToReleaseFence = true;
      throw error;
    } finally {
      this.#resetting.delete(participantId);
      if (safeToReleaseFence) await fence.release();
    }
  }
}

function cleanerConfig(
  config: AgentMemoryConfigSnapshot,
  memoryIndexPath: string,
): AgentMemoryCleanerConfig {
  return Object.freeze({
    enabled: config.effective.enabled,
    intervalMs: config.effective.interval_ms,
    memoryIndexPath,
    ownerParticipantId: config.ownerParticipantId,
    revision: config.revision,
    thresholdBytes: config.effective.threshold_bytes,
  });
}

async function persistReceipt(
  rootDirectory: string,
  receipt: AgentMemoryResetReceipt,
): Promise<void> {
  const receiptRoot = join(rootDirectory, ".reset-receipts");
  await ensurePrivateDirectory(receiptRoot, "Agent memory reset receipt root");
  const path = resetReceiptPath(receiptRoot, receipt.operationId);
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(receipt)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(receiptRoot);
}

async function readResetReceipt(
  rootDirectory: string,
  operationId: string,
): Promise<AgentMemoryResetReceipt | null> {
  const receiptRoot = join(rootDirectory, ".reset-receipts");
  const path = resetReceiptPath(receiptRoot, operationId);
  try {
    await assertPrivateRegularFile(path, "Agent memory reset receipt");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error("Agent memory reset receipt is not valid JSON", {
      cause: error,
    });
  }
  if (!isResetReceipt(value) || value.operationId !== operationId) {
    throw new Error("Agent memory reset receipt is invalid");
  }
  return Object.freeze(value);
}

function resetReceiptPath(receiptRoot: string, operationId: string): string {
  return join(
    receiptRoot,
    `${createHash("sha256").update(operationId).digest("hex")}.json`,
  );
}

function resetOperationId(
  ownerParticipantId: string,
  idempotencyKey: string,
): string {
  return `memory-reset-${createHash("sha256")
    .update(ownerParticipantId)
    .update("\0")
    .update(idempotencyKey)
    .digest("hex")}`;
}

function isResetReceipt(value: unknown): value is AgentMemoryResetReceipt {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Record<string, unknown>;
  if (
    (receipt.kind !== "already_absent" && receipt.kind !== "quarantined") ||
    receipt.deduplicated !== false ||
    typeof receipt.operationId !== "string" ||
    typeof receipt.ownerParticipantId !== "string" ||
    !Number.isSafeInteger(receipt.providerContinuityRecords) ||
    Number(receipt.providerContinuityRecords) < 0 ||
    !Number.isSafeInteger(receipt.resetAtMs) ||
    Number(receipt.resetAtMs) < 0
  ) {
    return false;
  }
  return (
    (receipt.kind === "already_absent" &&
      receipt.quarantinePath === undefined) ||
    (receipt.kind === "quarantined" &&
      typeof receipt.quarantinePath === "string")
  );
}

async function ensurePrivateDirectory(
  path: string,
  label: string,
): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  await assertPrivateDirectory(path, label);
}

async function assertPrivateDirectory(
  path: string,
  label: string,
): Promise<void> {
  const metadata = await lstat(path);
  const currentUid = process.getuid?.();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (currentUid !== undefined && metadata.uid !== currentUid) ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new Error(`${label} is not private and owner-controlled: ${path}`);
  }
}

async function assertPrivateRegularFile(
  path: string,
  label: string,
): Promise<void> {
  const metadata = await lstat(path);
  const currentUid = process.getuid?.();
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    (currentUid !== undefined && metadata.uid !== currentUid) ||
    (Number(metadata.mode) & 0o077) !== 0
  ) {
    throw new Error(`${label} is not a private regular file: ${path}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function requireParticipantId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    /[\\/\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("Agent memory owner participant is invalid");
  }
  return value;
}

function requireIdempotencyKey(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("Agent memory reset idempotency key is invalid");
  }
  return value;
}

function safeEpoch(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Agent memory coordinator clock is invalid");
  }
  return value;
}
