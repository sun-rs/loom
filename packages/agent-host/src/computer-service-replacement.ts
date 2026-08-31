export type ComputerServiceReplacementAttestation = Readonly<{
  buildVersion: string;
  candidateComputerInstanceId: string;
  candidateProcessId: number;
  managedAttachmentIds: readonly string[];
  managedAttachmentIdentities: Readonly<Record<string, string>>;
  serviceGeneration: string;
  sourceProcessId: number;
}>;

export type ComputerServiceReplacementPreparedSnapshot = Readonly<{
  candidateComputerInstanceId: string;
  candidateProcessId: number;
  operationId: string;
  serviceGeneration: string;
  state: "prepared";
}>;

export type ComputerServiceReplacementCommittedSnapshot = Readonly<{
  candidateComputerInstanceId: string;
  candidateProcessId: number;
  operationId: string;
  serviceGeneration: string;
  state: "committed";
}>;

export type ComputerServiceReplacementRecoveryRequiredSnapshot = Readonly<{
  candidateProcessId?: number;
  operationId: string;
  reason: "candidate_alive" | "ownership_unrestored";
  state: "recovery_required";
}>;

export type ComputerServiceReplacementSnapshot =
  | Readonly<{ state: "idle" }>
  | Readonly<{ operationId: string; state: "preparing" }>
  | ComputerServiceReplacementPreparedSnapshot
  | ComputerServiceReplacementCommittedSnapshot
  | ComputerServiceReplacementRecoveryRequiredSnapshot;

export type ComputerServiceReplacementCoordinatorOptions = {
  attestationPollIntervalMs?: number;
  beforeCommitExit?(): Promise<void>;
  candidateShutdownTimeoutMs: number;
  currentProcessId: number;
  isProcessAlive(processId: number): boolean;
  nowMs(): number;
  readCandidateAttestation(input: {
    candidateProcessId: number;
    timeoutMs: number;
  }): Promise<ComputerServiceReplacementAttestation | null>;
  releaseOwnership(): Promise<void>;
  restoreOwnership(): Promise<void>;
  restoreOwnershipTimeoutMs?: number;
  scheduleIncumbentExit(): void;
  signalProcess(processId: number, signal: "SIGKILL" | "SIGTERM"): void;
  snapshotManagedAttachmentIdentities(): Promise<
    Readonly<Record<string, string>>
  >;
  spawnCandidate(input: {
    expectedBuildVersion: string;
    operationId: string;
    sourceProcessId: number;
  }): Promise<number>;
  takeoverTimeoutMs: number;
  wait(milliseconds: number): Promise<void>;
};

type ReplacementIdentity = Readonly<{
  attachmentIds: readonly string[];
  attachmentIdentities: Readonly<Record<string, string>>;
  expectedBuildVersion: string;
  operationId: string;
}>;

type PreparedState = ReplacementIdentity &
  Readonly<{
    attestation: ComputerServiceReplacementAttestation;
    candidateProcessId: number;
    state: "prepared";
  }>;

type CommittedState = Omit<PreparedState, "state"> &
  Readonly<{ state: "committed" }>;

type CoordinatorState =
  | Readonly<{ state: "idle" }>
  | Readonly<{ operationId: string; state: "preparing" }>
  | PreparedState
  | CommittedState
  | ComputerServiceReplacementRecoveryRequiredSnapshot;

type InFlightPreparation = Readonly<{
  expectedBuildVersion: string;
  operationId: string;
  promise: Promise<ComputerServiceReplacementPreparedSnapshot>;
}>;

export class ComputerServiceReplacementBusyError extends Error {}
export class ComputerServiceReplacementRecoveryError extends Error {}

/**
 * Proves a whole-service candidate before the incumbent yields permanently.
 *
 * The coordinator accepts no remote command, path, URL, environment, or log
 * body. Candidate launch and ownership transfer are narrow local effects. A
 * candidate is eligible only when its process, source process, build, service
 * generation, Computer instance, and every managed attachment identity match
 * the incumbent's frozen snapshot.
 */
export class ComputerServiceReplacementCoordinator {
  readonly #attestationPollIntervalMs: number;
  readonly #beforeCommitExit:
    | ComputerServiceReplacementCoordinatorOptions["beforeCommitExit"]
    | undefined;
  readonly #candidateShutdownTimeoutMs: number;
  readonly #currentProcessId: number;
  readonly #isProcessAlive: ComputerServiceReplacementCoordinatorOptions["isProcessAlive"];
  readonly #nowMs: ComputerServiceReplacementCoordinatorOptions["nowMs"];
  readonly #readCandidateAttestation: ComputerServiceReplacementCoordinatorOptions["readCandidateAttestation"];
  readonly #releaseOwnership: ComputerServiceReplacementCoordinatorOptions["releaseOwnership"];
  readonly #restoreOwnership: ComputerServiceReplacementCoordinatorOptions["restoreOwnership"];
  readonly #restoreOwnershipTimeoutMs: number;
  readonly #scheduleIncumbentExit: ComputerServiceReplacementCoordinatorOptions["scheduleIncumbentExit"];
  readonly #signalProcess: ComputerServiceReplacementCoordinatorOptions["signalProcess"];
  readonly #snapshotManagedAttachmentIdentities: ComputerServiceReplacementCoordinatorOptions["snapshotManagedAttachmentIdentities"];
  readonly #spawnCandidate: ComputerServiceReplacementCoordinatorOptions["spawnCandidate"];
  readonly #takeoverTimeoutMs: number;
  readonly #wait: ComputerServiceReplacementCoordinatorOptions["wait"];
  #inFlight: InFlightPreparation | undefined;
  #state: CoordinatorState = Object.freeze({ state: "idle" });

  constructor(options: ComputerServiceReplacementCoordinatorOptions) {
    this.#attestationPollIntervalMs = positiveMilliseconds(
      options.attestationPollIntervalMs ?? 100,
      "attestationPollIntervalMs",
    );
    this.#beforeCommitExit = options.beforeCommitExit;
    this.#candidateShutdownTimeoutMs = positiveMilliseconds(
      options.candidateShutdownTimeoutMs,
      "candidateShutdownTimeoutMs",
    );
    this.#currentProcessId = positiveInteger(
      options.currentProcessId,
      "currentProcessId",
    );
    this.#isProcessAlive = options.isProcessAlive;
    this.#nowMs = options.nowMs;
    this.#readCandidateAttestation = options.readCandidateAttestation;
    this.#releaseOwnership = options.releaseOwnership;
    this.#restoreOwnership = options.restoreOwnership;
    this.#restoreOwnershipTimeoutMs = positiveMilliseconds(
      options.restoreOwnershipTimeoutMs ?? options.takeoverTimeoutMs,
      "restoreOwnershipTimeoutMs",
    );
    this.#scheduleIncumbentExit = options.scheduleIncumbentExit;
    this.#signalProcess = options.signalProcess;
    this.#snapshotManagedAttachmentIdentities =
      options.snapshotManagedAttachmentIdentities;
    this.#spawnCandidate = options.spawnCandidate;
    this.#takeoverTimeoutMs = positiveMilliseconds(
      options.takeoverTimeoutMs,
      "takeoverTimeoutMs",
    );
    this.#wait = options.wait;
  }

  snapshot(): ComputerServiceReplacementSnapshot {
    if (this.#state.state === "idle") return Object.freeze({ state: "idle" });
    if (this.#state.state === "preparing") {
      return Object.freeze({
        operationId: this.#state.operationId,
        state: "preparing",
      });
    }
    if (this.#state.state === "recovery_required") return this.#state;
    return publicSnapshot(this.#state);
  }

  async prepare(input: {
    expectedBuildVersion: string;
    operationId: string;
  }): Promise<ComputerServiceReplacementPreparedSnapshot> {
    const operationId = requiredIdentifier(
      input.operationId,
      "operationId",
      512,
    );
    const expectedBuildVersion = requiredIdentifier(
      input.expectedBuildVersion,
      "expectedBuildVersion",
      128,
    );
    if (this.#state.state === "prepared") {
      requireSameRequest(this.#state, operationId, expectedBuildVersion);
      return publicPreparedSnapshot(this.#state);
    }
    if (this.#state.state === "committed") {
      throw new ComputerServiceReplacementBusyError(
        "Computer service replacement has already committed",
      );
    }
    if (this.#state.state === "recovery_required") {
      throw new ComputerServiceReplacementRecoveryError(
        "Computer service replacement requires operator recovery",
      );
    }
    if (this.#inFlight !== undefined) {
      requireSameRequest(this.#inFlight, operationId, expectedBuildVersion);
      return await this.#inFlight.promise;
    }

    this.#state = Object.freeze({ operationId, state: "preparing" });
    const promise = this.#prepare({ expectedBuildVersion, operationId });
    this.#inFlight = Object.freeze({
      expectedBuildVersion,
      operationId,
      promise,
    });
    const clear = () => {
      if (this.#inFlight?.promise === promise) this.#inFlight = undefined;
    };
    void promise.then(clear, clear);
    return await promise;
  }

  async commit(
    untrustedOperationId: string,
  ): Promise<ComputerServiceReplacementCommittedSnapshot> {
    const operationId = requiredIdentifier(
      untrustedOperationId,
      "operationId",
      512,
    );
    if (this.#state.state === "committed") {
      if (this.#state.operationId !== operationId) throw busy();
      return publicCommittedSnapshot(this.#state);
    }
    if (this.#state.state === "recovery_required") {
      throw new ComputerServiceReplacementRecoveryError(
        "Computer service replacement requires operator recovery",
      );
    }
    if (this.#state.state !== "prepared") {
      throw new Error("Computer service replacement is not prepared");
    }
    if (this.#state.operationId !== operationId) throw busy();
    const prepared = this.#state;
    try {
      await this.#beforeCommitExit?.();
      this.#scheduleIncumbentExit();
    } catch {
      await this.#rollbackCandidate(
        prepared.operationId,
        prepared.candidateProcessId,
      );
      throw new Error("Computer service replacement commit failed safely");
    }
    const committed = Object.freeze({
      ...prepared,
      state: "committed" as const,
    });
    this.#state = committed;
    return publicCommittedSnapshot(committed);
  }

  async abort(untrustedOperationId: string): Promise<void> {
    const operationId = requiredIdentifier(
      untrustedOperationId,
      "operationId",
      512,
    );
    if (this.#state.state === "idle") return;
    if (this.#state.operationId !== operationId) throw busy();
    if (this.#state.state === "recovery_required") {
      throw new ComputerServiceReplacementRecoveryError(
        "Computer service replacement requires operator recovery",
      );
    }
    if (this.#state.state === "preparing") {
      throw new ComputerServiceReplacementBusyError(
        "Computer service replacement is still preparing",
      );
    }
    if (this.#state.state === "committed") {
      throw new Error("A committed Computer service replacement cannot abort");
    }
    await this.#rollbackCandidate(
      this.#state.operationId,
      this.#state.candidateProcessId,
    );
  }

  async #prepare(
    input: Readonly<{
      expectedBuildVersion: string;
      operationId: string;
    }>,
  ): Promise<ComputerServiceReplacementPreparedSnapshot> {
    let candidateProcessId: number | undefined;
    let ownershipReleased = false;
    try {
      const attachmentIdentities = freezeAttachmentIdentities(
        await this.#snapshotManagedAttachmentIdentities(),
      );
      const attachmentIds = Object.freeze(Object.keys(attachmentIdentities));
      await this.#releaseOwnership();
      ownershipReleased = true;
      candidateProcessId = positiveInteger(
        await this.#spawnCandidate({
          expectedBuildVersion: input.expectedBuildVersion,
          operationId: input.operationId,
          sourceProcessId: this.#currentProcessId,
        }),
        "candidateProcessId",
      );
      if (candidateProcessId === this.#currentProcessId) {
        throw new Error("Candidate process must differ from incumbent process");
      }
      const identity: ReplacementIdentity = Object.freeze({
        attachmentIdentities,
        attachmentIds,
        expectedBuildVersion: input.expectedBuildVersion,
        operationId: input.operationId,
      });
      const proven = await this.#waitForExactAttestation(
        identity,
        candidateProcessId,
      );
      const prepared: PreparedState = Object.freeze({
        ...identity,
        attestation: proven,
        candidateProcessId,
        state: "prepared",
      });
      this.#state = prepared;
      return publicPreparedSnapshot(prepared);
    } catch {
      await this.#recoverAfterFailure({
        ...(candidateProcessId === undefined ? {} : { candidateProcessId }),
        operationId: input.operationId,
        ownershipReleased,
      });
      throw new Error(
        "Candidate failed to prove exclusive ownership and identity",
      );
    }
  }

  async #waitForExactAttestation(
    identity: ReplacementIdentity,
    candidateProcessId: number,
  ): Promise<ComputerServiceReplacementAttestation> {
    const deadline = this.#nowMs() + this.#takeoverTimeoutMs;
    while (true) {
      const remaining = Math.max(0, deadline - this.#nowMs());
      const observed = await this.#readCandidateAttestation({
        candidateProcessId,
        timeoutMs: remaining,
      });
      if (
        observed !== null &&
        exactAttestation(
          observed,
          identity,
          candidateProcessId,
          this.#currentProcessId,
        )
      ) {
        return freezeAttestation(observed);
      }
      const afterReadRemaining = deadline - this.#nowMs();
      if (afterReadRemaining <= 0) {
        throw new Error("Candidate attestation timed out");
      }
      await this.#wait(
        Math.min(this.#attestationPollIntervalMs, afterReadRemaining),
      );
    }
  }

  async #rollbackCandidate(
    operationId: string,
    candidateProcessId: number,
  ): Promise<void> {
    await this.#recoverAfterFailure({
      candidateProcessId,
      operationId,
      ownershipReleased: true,
    });
  }

  async #recoverAfterFailure(input: {
    candidateProcessId?: number;
    operationId: string;
    ownershipReleased: boolean;
  }): Promise<void> {
    if (input.candidateProcessId !== undefined) {
      try {
        await this.#terminateCandidate(input.candidateProcessId);
      } catch {
        this.#state = Object.freeze({
          candidateProcessId: input.candidateProcessId,
          operationId: input.operationId,
          reason: "candidate_alive",
          state: "recovery_required",
        });
        throw new ComputerServiceReplacementRecoveryError(
          "Computer service replacement candidate remains alive",
        );
      }
    }
    if (input.ownershipReleased) {
      try {
        await this.#restoreIncumbentOwnership();
      } catch {
        this.#state = Object.freeze({
          ...(input.candidateProcessId === undefined
            ? {}
            : { candidateProcessId: input.candidateProcessId }),
          operationId: input.operationId,
          reason: "ownership_unrestored",
          state: "recovery_required",
        });
        throw new ComputerServiceReplacementRecoveryError(
          "Computer service incumbent ownership remains unproven",
        );
      }
    }
    this.#state = Object.freeze({ state: "idle" });
  }

  async #terminateCandidate(candidateProcessId: number): Promise<void> {
    if (!this.#isProcessAlive(candidateProcessId)) return;
    try {
      this.#signalProcess(candidateProcessId, "SIGTERM");
    } catch {
      // Liveness is checked after the bounded grace period.
    }
    await this.#wait(this.#candidateShutdownTimeoutMs);
    if (!this.#isProcessAlive(candidateProcessId)) return;
    try {
      this.#signalProcess(candidateProcessId, "SIGKILL");
    } catch {
      // The final liveness check below remains authoritative.
    }
    await this.#wait(this.#candidateShutdownTimeoutMs);
    if (this.#isProcessAlive(candidateProcessId)) {
      throw new ComputerServiceReplacementRecoveryError(
        "Computer service replacement candidate could not be terminated",
      );
    }
  }

  async #restoreIncumbentOwnership(): Promise<void> {
    const deadline = this.#nowMs() + this.#restoreOwnershipTimeoutMs;
    while (true) {
      try {
        await this.#restoreOwnership();
        return;
      } catch {
        const remaining = deadline - this.#nowMs();
        if (remaining <= 0) {
          throw new ComputerServiceReplacementRecoveryError(
            "Computer service incumbent ownership could not be restored",
          );
        }
        await this.#wait(Math.min(this.#attestationPollIntervalMs, remaining));
      }
    }
  }
}

function publicSnapshot(
  state: PreparedState | CommittedState,
):
  | ComputerServiceReplacementPreparedSnapshot
  | ComputerServiceReplacementCommittedSnapshot {
  return state.state === "prepared"
    ? publicPreparedSnapshot(state)
    : publicCommittedSnapshot(state);
}

function publicPreparedSnapshot(
  state: PreparedState,
): ComputerServiceReplacementPreparedSnapshot {
  return Object.freeze({
    candidateComputerInstanceId: state.attestation.candidateComputerInstanceId,
    candidateProcessId: state.candidateProcessId,
    operationId: state.operationId,
    serviceGeneration: state.attestation.serviceGeneration,
    state: "prepared",
  });
}

function publicCommittedSnapshot(
  state: CommittedState,
): ComputerServiceReplacementCommittedSnapshot {
  return Object.freeze({
    candidateComputerInstanceId: state.attestation.candidateComputerInstanceId,
    candidateProcessId: state.candidateProcessId,
    operationId: state.operationId,
    serviceGeneration: state.attestation.serviceGeneration,
    state: "committed",
  });
}

function requireSameRequest(
  current: Readonly<{
    expectedBuildVersion: string;
    operationId: string;
  }>,
  operationId: string,
  expectedBuildVersion: string,
): void {
  if (
    current.operationId !== operationId ||
    current.expectedBuildVersion !== expectedBuildVersion
  ) {
    throw busy();
  }
}

function busy(): ComputerServiceReplacementBusyError {
  return new ComputerServiceReplacementBusyError(
    "Another Computer service replacement owns the handoff",
  );
}

function exactAttestation(
  observed: ComputerServiceReplacementAttestation,
  identity: ReplacementIdentity,
  candidateProcessId: number,
  sourceProcessId: number,
): boolean {
  if (
    observed.buildVersion !== identity.expectedBuildVersion ||
    observed.candidateProcessId !== candidateProcessId ||
    observed.sourceProcessId !== sourceProcessId ||
    !nonEmptyString(observed.candidateComputerInstanceId, 512) ||
    !nonEmptyString(observed.serviceGeneration, 512) ||
    !Array.isArray(observed.managedAttachmentIds) ||
    !sameStrings(observed.managedAttachmentIds, identity.attachmentIds)
  ) {
    return false;
  }
  if (!isRecord(observed.managedAttachmentIdentities)) return false;
  const observedKeys = Object.keys(observed.managedAttachmentIdentities).sort();
  if (!sameStrings(observedKeys, identity.attachmentIds)) return false;
  return identity.attachmentIds.every(
    (attachmentId) =>
      observed.managedAttachmentIdentities[attachmentId] ===
      identity.attachmentIdentities[attachmentId],
  );
}

function freezeAttestation(
  value: ComputerServiceReplacementAttestation,
): ComputerServiceReplacementAttestation {
  return Object.freeze({
    buildVersion: value.buildVersion,
    candidateComputerInstanceId: value.candidateComputerInstanceId,
    candidateProcessId: value.candidateProcessId,
    managedAttachmentIdentities: Object.freeze({
      ...value.managedAttachmentIdentities,
    }),
    managedAttachmentIds: Object.freeze([...value.managedAttachmentIds]),
    serviceGeneration: value.serviceGeneration,
    sourceProcessId: value.sourceProcessId,
  });
}

function freezeAttachmentIdentities(
  value: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    throw new Error("Managed attachment identities must be a record");
  }
  const keys = Object.keys(value).sort();
  const result: Record<string, string> = {};
  for (const key of keys) {
    const attachmentId = requiredIdentifier(key, "attachmentId", 512);
    Object.defineProperty(result, attachmentId, {
      configurable: false,
      enumerable: true,
      value: requiredIdentifier(
        value[key],
        `managedAttachmentIdentities.${attachmentId}`,
        512,
      ),
      writable: false,
    });
  }
  return Object.freeze(result);
}

function sameStrings(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function nonEmptyString(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value
  );
}

function requiredIdentifier(
  value: unknown,
  name: string,
  maximumLength: number,
): string {
  if (!nonEmptyString(value, maximumLength) || value.includes("\0")) {
    throw new Error(`${name} must be a non-empty bounded identifier`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return value;
}

function positiveMilliseconds(value: number, name: string): number {
  return positiveInteger(value, name);
}

function isRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
