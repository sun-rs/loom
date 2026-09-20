import { canonicalAgentIdField } from "@rah-os/protocol";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { join } from "node:path";

import {
  AgentExecutionResetModeSchema,
  ClientAgentExecutionResetResponseSchema,
  type AgentExecutionResetMode,
  type ClientAgentExecutionResetResponse,
} from "@rah-os/protocol";

import type { AgentHostControlPort } from "./agent-host-control.ts";

const MAX_IDENTIFIER_LENGTH = 1_024;
const MAX_RECEIPT_BYTES = 32 * 1_024;
const DEFAULT_EXECUTION_RESET_LEASE_MS = 30_000;
const DEFAULT_EXECUTION_RESET_RETRY_DELAY_MS = 100;
const DEFAULT_EXECUTION_RESET_TIMEOUT_MS = 30_000;

export type AgentExecutionResetFence = Readonly<{
  release(): Promise<void>;
}>;

export type AgentExecutionProviderContinuityQuarantine = Readonly<{
  recordCount: number;
  rollback(): Promise<void>;
}>;

export type AgentExecutionWorkspaceQuarantine = Readonly<{
  commit(): void;
  rollback(): Promise<void>;
}>;

export type AgentExecutionResetInput = Readonly<{
  agentId: string;
  mode: AgentExecutionResetMode;
  operationId: string;
  ownerParticipantId: string;
}>;

export type AgentExecutionResetReceipt = ClientAgentExecutionResetResponse;

export type AgentExecutionResetCoordinatorOptions = Readonly<{
  finalizeCommittedWorkspace?: (
    receipt: AgentExecutionResetReceipt,
  ) => Promise<void>;
  acquireFence(
    ownerParticipantId: string,
    operationId: string,
  ): Promise<AgentExecutionResetFence>;
  computerHostId: string;
  now?: () => Date;
  quarantineAgentWorkspace?: (
    ownerParticipantId: string,
    operationId: string,
  ) => Promise<AgentExecutionWorkspaceQuarantine>;
  quarantineProviderContinuity(
    ownerParticipantId: string,
    operationId: string,
  ): Promise<AgentExecutionProviderContinuityQuarantine>;
  rootDirectory: string;
}>;

export function createAgentExecutionResetFenceAcquirer(
  control: Pick<
    AgentHostControlPort,
    | "acquireAgentExclusiveOperationLease"
    | "releaseAgentExclusiveOperationLease"
  >,
  options: Readonly<{
    leaseMs?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
    wait?: (delayMs: number) => Promise<void>;
  }> = {},
): (
  ownerParticipantId: string,
  operationId: string,
) => Promise<AgentExecutionResetFence> {
  const leaseMs = options.leaseMs ?? DEFAULT_EXECUTION_RESET_LEASE_MS;
  const retryDelayMs =
    options.retryDelayMs ?? DEFAULT_EXECUTION_RESET_RETRY_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_EXECUTION_RESET_TIMEOUT_MS;
  const wait =
    options.wait ??
    (async (delayMs: number) => {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    });
  for (const [name, value] of [
    ["leaseMs", leaseMs],
    ["retryDelayMs", retryDelayMs],
    ["timeoutMs", timeoutMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive safe integer`);
    }
  }
  const acquire = control.acquireAgentExclusiveOperationLease;
  const release = control.releaseAgentExclusiveOperationLease;
  if (acquire === undefined || release === undefined) {
    throw new Error(
      "AgentHost control does not support the execution restart fence",
    );
  }
  return async (ownerParticipantId, operationId) => {
    const deadline = Date.now() + timeoutMs;
    let lease: Awaited<ReturnType<typeof acquire>>;
    for (;;) {
      try {
        lease = await acquire({
          kind: "execution_restart",
          leaseMs,
          operationId,
          participantId: ownerParticipantId,
        });
        break;
      } catch (error) {
        if (!isConflict(error) || Date.now() >= deadline) throw error;
        await wait(Math.min(retryDelayMs, Math.max(1, deadline - Date.now())));
      }
    }
    let released = false;
    return Object.freeze({
      release: async () => {
        if (released) return;
        await release({
          leaseId: lease.leaseId,
          operationId: lease.operationId,
        });
        released = true;
      },
    });
  };
}

type InFlight = Readonly<{
  identity: string;
  promise: Promise<AgentExecutionResetReceipt>;
}>;

/**
 * Performs the Host-local effect after the caller has durably disabled the
 * Agent. Kernel owns the execution fence; this coordinator only owns the
 * rollback-capable Provider-continuity effect and its terminal receipt.
 */
export class AgentExecutionResetCoordinator {
  readonly #finalizeCommittedWorkspace: AgentExecutionResetCoordinatorOptions["finalizeCommittedWorkspace"];
  readonly #acquireFence: AgentExecutionResetCoordinatorOptions["acquireFence"];
  readonly #computerHostId: string;
  readonly #inFlight = new Map<string, InFlight>();
  readonly #now: () => Date;
  readonly #quarantineAgentWorkspace:
    | AgentExecutionResetCoordinatorOptions["quarantineAgentWorkspace"]
    | undefined;
  readonly #quarantineProviderContinuity: AgentExecutionResetCoordinatorOptions["quarantineProviderContinuity"];
  readonly #rootDirectory: string;

  constructor(options: AgentExecutionResetCoordinatorOptions) {
    this.#finalizeCommittedWorkspace = options.finalizeCommittedWorkspace;
    this.#acquireFence = options.acquireFence;
    this.#computerHostId = requiredIdentifier(
      options.computerHostId,
      "computerHostId",
    );
    this.#now = options.now ?? (() => new Date());
    this.#quarantineAgentWorkspace = options.quarantineAgentWorkspace;
    this.#quarantineProviderContinuity = options.quarantineProviderContinuity;
    this.#rootDirectory = options.rootDirectory;
  }

  async receipt(
    uncheckedOperationId: string,
  ): Promise<AgentExecutionResetReceipt | null> {
    const operationId = requiredIdentifier(uncheckedOperationId, "operationId");
    return await readAgentExecutionResetReceipt(
      this.#rootDirectory,
      operationId,
    );
  }

  async reset(
    uncheckedInput: AgentExecutionResetInput,
    hooks: Readonly<{ afterContinuity?: () => Promise<void> }> = {},
  ): Promise<AgentExecutionResetReceipt> {
    const input = validateInput(uncheckedInput);
    const identity = operationIdentity(input);
    const existing = await this.receipt(input.operationId);
    if (existing !== null) {
      assertReceiptIdentity(existing, input);
      await this.#finalizeCommittedWorkspace?.(existing);
      return Object.freeze({ ...existing, deduplicated: true });
    }
    const active = this.#inFlight.get(input.operationId);
    if (active !== undefined) {
      if (active.identity !== identity) {
        throw new Error(
          `Agent execution reset ${input.operationId} has different immutable identity`,
        );
      }
      const receipt = await active.promise;
      return Object.freeze({ ...receipt, deduplicated: true });
    }
    const promise = this.#perform(input, hooks);
    this.#inFlight.set(input.operationId, { identity, promise });
    try {
      return await promise;
    } finally {
      if (this.#inFlight.get(input.operationId)?.promise === promise) {
        this.#inFlight.delete(input.operationId);
      }
    }
  }

  async #perform(
    input: AgentExecutionResetInput,
    hooks: Readonly<{ afterContinuity?: () => Promise<void> }>,
  ): Promise<AgentExecutionResetReceipt> {
    const fence = await this.#acquireFence(
      input.ownerParticipantId,
      input.operationId,
    );
    let continuity: AgentExecutionProviderContinuityQuarantine | undefined;
    let workspace: AgentExecutionWorkspaceQuarantine | undefined;
    let safeToRelease = input.mode === "restart";
    let receiptWriteAttempted = false;
    try {
      if (input.mode === "full") {
        if (this.#quarantineAgentWorkspace === undefined) {
          throw new Error(
            "Full Agent reset requires an Agent workspace quarantine owner",
          );
        }
        workspace = await this.#quarantineAgentWorkspace(
          input.ownerParticipantId,
          input.operationId,
        );
      }
      if (input.mode !== "restart") {
        continuity = await this.#quarantineProviderContinuity(
          input.ownerParticipantId,
          input.operationId,
        );
        if (
          !Number.isSafeInteger(continuity.recordCount) ||
          continuity.recordCount < 0
        ) {
          throw new Error(
            "Provider continuity quarantine returned an invalid record count",
          );
        }
      }
      await hooks.afterContinuity?.();
      const receipt = ClientAgentExecutionResetResponseSchema.parse({
        agentId: input.agentId,
        completedAt: this.#now().toISOString(),
        computerHostId: this.#computerHostId,
        deduplicated: false,
        mode: input.mode,
        operationId: input.operationId,
        ownerParticipantId: input.ownerParticipantId,
        providerContinuityRecords: continuity?.recordCount ?? 0,
      });
      receiptWriteAttempted = true;
      await persistReceipt(this.#rootDirectory, receipt);
      workspace?.commit();
      safeToRelease = true;
      return Object.freeze(receipt);
    } catch (error) {
      // A published receipt is the existing durable commit decision. Failure
      // after publication is finalization work, never permission to undo it.
      if (receiptWriteAttempted) {
        safeToRelease = false;
        let committed: AgentExecutionResetReceipt | null;
        try {
          committed = await this.receipt(input.operationId);
        } catch (readError) {
          throw new AggregateError(
            [error, readError],
            "Reset commit outcome is uncertain; execution fence retained",
          );
        }
        if (committed !== null) {
          assertReceiptIdentity(committed, input);
          safeToRelease = false;
          throw error;
        }
      }
      const rollbackErrors: unknown[] = [];
      if (continuity !== undefined) {
        try {
          await continuity.rollback();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (workspace !== undefined) {
        try {
          await workspace.rollback();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Agent reset failed and rollback could not prove a safe state",
        );
      }
      safeToRelease = true;
      throw error;
    } finally {
      if (safeToRelease) await fence.release();
    }
  }
}

async function persistReceipt(
  rootDirectory: string,
  receipt: AgentExecutionResetReceipt,
): Promise<void> {
  const receiptRoot = join(rootDirectory, ".receipts");
  await ensurePrivateDirectory(receiptRoot);
  const path = receiptPath(receiptRoot, receipt.operationId);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify({ schemaVersion: 1, ...receipt })}\n`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(payload, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, path);
  await syncDirectory(receiptRoot);
}

export async function readAgentExecutionResetReceipt(
  rootDirectory: string,
  operationId: string,
): Promise<AgentExecutionResetReceipt | null> {
  const path = receiptPath(join(rootDirectory, ".receipts"), operationId);
  try {
    const metadata = await lstat(path);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > MAX_RECEIPT_BYTES ||
      (metadata.mode & 0o077) !== 0
    ) {
      throw new Error("Agent execution reset receipt is not a private file");
    }
    const value = canonicalAgentIdField(
      JSON.parse(await readFile(path, "utf8")),
    ) as Record<string, unknown>;
    if (value.schemaVersion !== 1) {
      throw new Error("unsupported Agent execution reset receipt version");
    }
    const { schemaVersion: _, ...publicReceipt } = value;
    return ClientAgentExecutionResetResponseSchema.parse(publicReceipt);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  const metadata = await lstat(path);
  const currentUid = process.getuid?.();
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o077) !== 0 ||
    (currentUid !== undefined && metadata.uid !== currentUid)
  ) {
    throw new Error(`Agent execution reset directory is not private: ${path}`);
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function receiptPath(root: string, operationId: string): string {
  return join(root, `${encodeURIComponent(operationId)}.json`);
}

function validateInput(
  input: AgentExecutionResetInput,
): AgentExecutionResetInput {
  return Object.freeze({
    agentId: requiredIdentifier(input.agentId, "agentId"),
    mode: AgentExecutionResetModeSchema.parse(input.mode),
    operationId: requiredIdentifier(input.operationId, "operationId"),
    ownerParticipantId: requiredIdentifier(
      input.ownerParticipantId,
      "ownerParticipantId",
    ),
  });
}

function assertReceiptIdentity(
  receipt: AgentExecutionResetReceipt,
  input: AgentExecutionResetInput,
): void {
  if (
    receipt.agentId !== input.agentId ||
    receipt.mode !== input.mode ||
    receipt.ownerParticipantId !== input.ownerParticipantId
  ) {
    throw new Error(
      `Agent execution reset ${input.operationId} has different immutable identity`,
    );
  }
}

function operationIdentity(input: AgentExecutionResetInput): string {
  return JSON.stringify([input.agentId, input.mode, input.ownerParticipantId]);
}

function requiredIdentifier(value: string, name: string): string {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_IDENTIFIER_LENGTH ||
    normalized.includes("\0")
  ) {
    throw new Error(`${name} must be a bounded non-empty identifier`);
  }
  return normalized;
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function isConflict(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "conflict"
  );
}
