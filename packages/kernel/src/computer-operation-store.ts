import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { isIssuedHostContext, type AuthenticatedHostContext } from "./auth.ts";
import {
  ConflictError,
  IdempotencyConflictError,
  NotFoundError,
  UnauthenticatedError,
} from "./errors.ts";

export type ComputerOperationAction = "restart" | "upgrade";
export type ComputerOperationPhase =
  | "draining"
  | "downloading"
  | "verifying"
  | "staging"
  | "replacing"
  | "restarting";
export type ComputerOperationFailureCode =
  | "control_unavailable"
  | "download_failed"
  | "identity_attestation_failed"
  | "replacement_failed"
  | "staging_failed"
  | "unsupported_operation"
  | "verification_failed"
  | "version_attestation_failed";
export type ComputerOperationState =
  | "pending"
  | "claimed"
  | "in_progress"
  | "awaiting_reconnect"
  | "succeeded"
  | "failed";

export type ComputerOperationRecord = {
  action: ComputerOperationAction;
  claimedCredentialId?: string;
  claimedHostInstanceId?: string;
  completedAt?: string;
  failureCode?: ComputerOperationFailureCode;
  hostId: string;
  idempotencyKey: string;
  observedBuildVersion?: string;
  operationId: string;
  phase?: ComputerOperationPhase;
  readyHostInstanceId?: string;
  requestedAt: string;
  state: ComputerOperationState;
  targetBuildVersion?: string;
  updatedAt: string;
};

export type ComputerOperationAcknowledgeInput =
  | {
      kind: "operation.progress";
      operationId: string;
      phase: ComputerOperationPhase;
    }
  | {
      kind: "operation.ready";
      observedBuildVersion: string;
      operationId: string;
    }
  | {
      failureCode: ComputerOperationFailureCode;
      kind: "operation.failed";
      operationId: string;
      phase: ComputerOperationPhase;
    };

export type ComputerOperationStoreOptions = {
  createId?: () => string;
  databasePath: string;
  now?: () => Date;
};

const PHASES: Readonly<
  Record<ComputerOperationAction, ComputerOperationPhase[]>
> = {
  restart: ["draining", "restarting"],
  upgrade: [
    "draining",
    "downloading",
    "verifying",
    "staging",
    "replacing",
    "restarting",
  ],
};

/** Durable, actor-free execution state for a fixed managed Computer action. */
export class ComputerOperationStore {
  readonly #createId: () => string;
  readonly #database: DatabaseSync;
  readonly #now: () => Date;

  constructor(options: ComputerOperationStoreOptions) {
    this.#createId =
      options.createId ?? (() => `computer_operation_${randomUUID()}`);
    this.#database = new DatabaseSync(options.databasePath, { timeout: 5_000 });
    this.#now = options.now ?? (() => new Date());
  }

  close(): void {
    this.#database.close();
  }

  request(
    input:
      | {
          action: "restart";
          hostId: string;
          idempotencyKey: string;
        }
      | {
          action: "upgrade";
          hostId: string;
          idempotencyKey: string;
          targetBuildVersion: string;
        },
  ): ComputerOperationRecord {
    const hostId = required(input.hostId, "hostId");
    const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
    const targetBuildVersion =
      input.action === "upgrade"
        ? buildVersion(input.targetBuildVersion)
        : undefined;
    return this.#transaction(() => {
      if (
        this.#database
          .prepare("SELECT 1 FROM agent_hosts WHERE host_id = ?")
          .get(hostId) === undefined
      ) {
        throw new NotFoundError(`Host ${hostId} was not found`);
      }
      const replay = this.#database
        .prepare(
          "SELECT * FROM computer_operations WHERE host_id = ? AND idempotency_key = ?",
        )
        .get(hostId, idempotencyKey);
      if (replay !== undefined) {
        const existing = operationFromRow(replay);
        if (
          existing.action !== input.action ||
          existing.targetBuildVersion !== targetBuildVersion
        ) {
          throw new IdempotencyConflictError(
            `idempotency key ${idempotencyKey} was already used for another Computer operation`,
          );
        }
        return existing;
      }
      const active = this.#database
        .prepare(
          "SELECT operation_id FROM computer_operations WHERE host_id = ? AND state NOT IN ('succeeded', 'failed')",
        )
        .get(hostId);
      if (active !== undefined) {
        throw new ConflictError(
          `Host ${hostId} already has an active operation`,
        );
      }
      const now = this.#now().toISOString();
      const operationId = required(this.#createId(), "operationId");
      this.#database
        .prepare(
          `INSERT INTO computer_operations(
             operation_id, host_id, idempotency_key, action,
             target_build_version, state, requested_at, updated_at
           ) VALUES(?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          operationId,
          hostId,
          idempotencyKey,
          input.action,
          targetBuildVersion ?? null,
          now,
          now,
        );
      return this.get(operationId);
    });
  }

  claim(host: AuthenticatedHostContext): ComputerOperationRecord | null {
    return this.#transaction(() => {
      const hostBuildVersion = this.#requireCurrentHost(host);
      const row = this.#database
        .prepare(
          `SELECT * FROM computer_operations
           WHERE host_id = ? AND state NOT IN ('succeeded', 'failed')
           ORDER BY requested_at, operation_id LIMIT 1`,
        )
        .get(host.hostId);
      if (row === undefined) return null;
      const operation = operationFromRow(row);
      if (operation.state === "pending") {
        if (hostBuildVersion === undefined) {
          throw new ConflictError(
            "Computer operation claim requires an attested build version",
          );
        }
        const now = this.#now().toISOString();
        this.#database
          .prepare(
            `UPDATE computer_operations
             SET state = 'claimed', claimed_credential_id = ?,
                 claimed_host_instance_id = ?, observed_build_version = ?,
                 updated_at = ?
             WHERE operation_id = ? AND state = 'pending'`,
          )
          .run(
            host.credentialId,
            host.instanceId,
            hostBuildVersion,
            now,
            operation.operationId,
          );
        return this.get(operation.operationId);
      }
      if (operation.claimedCredentialId !== host.credentialId) {
        throw new UnauthenticatedError(
          "Computer operation credential is fenced",
        );
      }
      if (
        operation.state !== "awaiting_reconnect" &&
        operation.claimedHostInstanceId !== host.instanceId
      ) {
        if (operation.observedBuildVersion !== hostBuildVersion) {
          throw new ConflictError(
            "Computer operation recovery requires the frozen source build version",
          );
        }
        this.#database
          .prepare(
            `UPDATE computer_operations
             SET claimed_host_instance_id = ?, updated_at = ?
             WHERE operation_id = ?
               AND state NOT IN ('awaiting_reconnect', 'succeeded', 'failed')`,
          )
          .run(
            host.instanceId,
            this.#now().toISOString(),
            operation.operationId,
          );
        return this.get(operation.operationId);
      }
      return operation;
    });
  }

  acknowledge(
    host: AuthenticatedHostContext,
    input: ComputerOperationAcknowledgeInput,
  ): ComputerOperationRecord {
    return this.#transaction(() => {
      const hostBuildVersion = this.#requireCurrentHost(host);
      const operation = this.get(required(input.operationId, "operationId"));
      if (
        operation.hostId !== host.hostId ||
        operation.claimedCredentialId !== host.credentialId
      ) {
        throw new UnauthenticatedError("Computer operation is fenced");
      }
      if (input.kind === "operation.progress") {
        return this.#acknowledgeProgress(host, operation, input.phase);
      }
      if (input.kind === "operation.ready") {
        return this.#acknowledgeReady(
          host,
          operation,
          buildVersion(input.observedBuildVersion),
          hostBuildVersion,
        );
      }
      return this.#acknowledgeFailure(host, operation, input);
    });
  }

  get(operationId: string): ComputerOperationRecord {
    const normalized = required(operationId, "operationId");
    const row = this.#database
      .prepare("SELECT * FROM computer_operations WHERE operation_id = ?")
      .get(normalized);
    if (row === undefined) {
      throw new NotFoundError(`Computer operation ${normalized} was not found`);
    }
    return operationFromRow(row);
  }

  #acknowledgeProgress(
    host: AuthenticatedHostContext,
    operation: ComputerOperationRecord,
    phase: ComputerOperationPhase,
  ): ComputerOperationRecord {
    if (operation.state === "succeeded" || operation.state === "failed") {
      throw new ConflictError("Computer operation no longer accepts progress");
    }
    if (operation.state === "awaiting_reconnect") {
      if (operation.phase === phase) return operation;
      throw new ConflictError("Computer operation no longer accepts progress");
    }
    if (operation.claimedHostInstanceId !== host.instanceId) {
      throw new ConflictError(
        "Computer operation progress requires its claiming Host generation",
      );
    }
    const allowed = PHASES[operation.action];
    const nextIndex = allowed.indexOf(phase);
    if (nextIndex < 0) {
      throw new ConflictError(
        `phase ${phase} is not valid for ${operation.action}`,
      );
    }
    const currentIndex =
      operation.phase === undefined ? -1 : allowed.indexOf(operation.phase);
    if (nextIndex < currentIndex || nextIndex > currentIndex + 1) {
      throw new ConflictError("Computer operation progress must be monotonic");
    }
    if (nextIndex === currentIndex) return operation;
    const state = phase === "restarting" ? "awaiting_reconnect" : "in_progress";
    this.#database
      .prepare(
        "UPDATE computer_operations SET state = ?, phase = ?, updated_at = ? WHERE operation_id = ?",
      )
      .run(state, phase, this.#now().toISOString(), operation.operationId);
    return this.get(operation.operationId);
  }

  #acknowledgeReady(
    host: AuthenticatedHostContext,
    operation: ComputerOperationRecord,
    observedBuildVersion: string,
    hostBuildVersion: string | undefined,
  ): ComputerOperationRecord {
    if (operation.state === "succeeded") {
      if (
        operation.readyHostInstanceId === host.instanceId &&
        operation.observedBuildVersion === observedBuildVersion
      ) {
        return operation;
      }
      throw new ConflictError("Computer operation already completed elsewhere");
    }
    if (operation.state !== "awaiting_reconnect") {
      throw new ConflictError("Computer operation is not awaiting reconnect");
    }
    if (operation.claimedHostInstanceId === host.instanceId) {
      throw new ConflictError(
        "Computer operation ready requires a successor Host generation",
      );
    }
    if (hostBuildVersion !== observedBuildVersion) {
      throw new ConflictError(
        "Computer operation build attestation does not match heartbeat",
      );
    }
    if (
      (operation.action === "upgrade"
        ? operation.targetBuildVersion
        : operation.observedBuildVersion) !== observedBuildVersion
    ) {
      throw new ConflictError(
        "Computer operation did not reach its expected build version",
      );
    }
    const now = this.#now().toISOString();
    this.#database
      .prepare(
        `UPDATE computer_operations
         SET state = 'succeeded', ready_host_instance_id = ?,
             observed_build_version = ?, updated_at = ?, completed_at = ?
         WHERE operation_id = ?`,
      )
      .run(
        host.instanceId,
        observedBuildVersion,
        now,
        now,
        operation.operationId,
      );
    return this.get(operation.operationId);
  }

  #acknowledgeFailure(
    host: AuthenticatedHostContext,
    operation: ComputerOperationRecord,
    input: Extract<
      ComputerOperationAcknowledgeInput,
      { kind: "operation.failed" }
    >,
  ): ComputerOperationRecord {
    if (operation.state === "failed") {
      if (
        operation.failureCode === input.failureCode &&
        operation.phase === input.phase
      ) {
        return operation;
      }
      throw new ConflictError("Computer operation already failed differently");
    }
    if (operation.state === "succeeded") {
      throw new ConflictError("Computer operation already succeeded");
    }
    if (
      operation.state !== "awaiting_reconnect" &&
      operation.claimedHostInstanceId !== host.instanceId
    ) {
      throw new ConflictError(
        "Computer operation failure is generation-fenced",
      );
    }
    if (!PHASES[operation.action].includes(input.phase)) {
      throw new ConflictError(
        `phase ${input.phase} is not valid for ${operation.action}`,
      );
    }
    const now = this.#now().toISOString();
    this.#database
      .prepare(
        `UPDATE computer_operations
         SET state = 'failed', phase = ?, failure_code = ?,
             updated_at = ?, completed_at = ? WHERE operation_id = ?`,
      )
      .run(input.phase, input.failureCode, now, now, operation.operationId);
    return this.get(operation.operationId);
  }

  #requireCurrentHost(host: AuthenticatedHostContext): string | undefined {
    if (!isIssuedHostContext(host)) {
      throw new UnauthenticatedError("host authentication context is invalid");
    }
    const row = this.#database
      .prepare(
        `SELECT agent_hosts.build_version
         FROM agent_hosts
         JOIN agent_host_credentials
           ON agent_host_credentials.credential_id = agent_hosts.credential_id
         WHERE agent_hosts.host_id = ?
           AND agent_hosts.instance_id = ?
           AND agent_hosts.credential_id = ?
           AND agent_hosts.state != 'offline'
           AND agent_host_credentials.revoked_at IS NULL`,
      )
      .get(host.hostId, host.instanceId, host.credentialId);
    if (row === undefined) {
      throw new UnauthenticatedError("Host daemon instance is not active");
    }
    return nullableString(row, "build_version");
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec("ROLLBACK");
      throw error;
    }
  }
}

function operationFromRow(
  row: Record<string, unknown>,
): ComputerOperationRecord {
  const action = enumValue(row, "action", ["restart", "upgrade"] as const);
  const state = enumValue(row, "state", [
    "pending",
    "claimed",
    "in_progress",
    "awaiting_reconnect",
    "succeeded",
    "failed",
  ] as const);
  const phase = nullableEnum(row, "phase", [
    "draining",
    "downloading",
    "verifying",
    "staging",
    "replacing",
    "restarting",
  ] as const);
  const failureCode = nullableEnum(row, "failure_code", [
    "control_unavailable",
    "download_failed",
    "identity_attestation_failed",
    "replacement_failed",
    "staging_failed",
    "unsupported_operation",
    "verification_failed",
    "version_attestation_failed",
  ] as const);
  const claimedCredentialId = nullableString(row, "claimed_credential_id");
  const claimedHostInstanceId = nullableString(row, "claimed_host_instance_id");
  const completedAt = nullableString(row, "completed_at");
  const observedBuildVersion = nullableString(row, "observed_build_version");
  const readyHostInstanceId = nullableString(row, "ready_host_instance_id");
  const targetBuildVersion = nullableString(row, "target_build_version");
  return {
    action,
    ...(claimedCredentialId === undefined ? {} : { claimedCredentialId }),
    ...(claimedHostInstanceId === undefined ? {} : { claimedHostInstanceId }),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(failureCode === undefined ? {} : { failureCode }),
    hostId: stringValue(row, "host_id"),
    idempotencyKey: stringValue(row, "idempotency_key"),
    ...(observedBuildVersion === undefined ? {} : { observedBuildVersion }),
    operationId: stringValue(row, "operation_id"),
    ...(phase === undefined ? {} : { phase }),
    ...(readyHostInstanceId === undefined ? {} : { readyHostInstanceId }),
    requestedAt: stringValue(row, "requested_at"),
    state,
    ...(targetBuildVersion === undefined ? {} : { targetBuildVersion }),
    updatedAt: stringValue(row, "updated_at"),
  };
}

function required(value: string, name: string): string {
  const result = value.trim();
  if (result.length === 0 || result.length > 512 || result.includes("\0")) {
    throw new Error(`${name} is invalid`);
  }
  return result;
}

function buildVersion(value: string): string {
  const result = required(value, "buildVersion");
  if (result.length > 128) throw new Error("buildVersion is too long");
  return result;
}

function stringValue(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (typeof value !== "string") throw new Error(`invalid ${name}`);
  return value;
}

function nullableString(
  row: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = row[name];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`invalid ${name}`);
  return value;
}

function enumValue<const Values extends readonly string[]>(
  row: Record<string, unknown>,
  name: string,
  values: Values,
): Values[number] {
  const value = stringValue(row, name);
  if (!values.includes(value)) throw new Error(`invalid ${name}`);
  return value;
}

function nullableEnum<const Values extends readonly string[]>(
  row: Record<string, unknown>,
  name: string,
  values: Values,
): Values[number] | undefined {
  const value = nullableString(row, name);
  if (value === undefined) return undefined;
  if (!values.includes(value)) throw new Error(`invalid ${name}`);
  return value;
}
