import type { DatabaseSync } from "node:sqlite";

import {
  RunWatchdogContextSchema,
  RunWatchdogReadInputSchema,
  RunWatchdogWarningInputSchema,
  type RunWatchdogContext,
  type RunWatchdogReadInput,
  type RunWatchdogWarningInput,
} from "@rah-os/protocol";

import { ForbiddenError, NotFoundError } from "./errors.ts";
import type { RoomEventWriter } from "./room-event-writer.ts";
import type { RunGuardPolicy } from "./run-guard-policy.ts";
import type { RuntimeTrajectoryServiceOptions } from "./runtime-trajectory.ts";
import { text } from "./sqlite-row.ts";
import { inImmediateTransaction } from "./sqlite-transaction.ts";
import { SYSTEM_PRINCIPAL_ID } from "./system-principal.ts";

type HostContext = Parameters<
  RuntimeTrajectoryServiceOptions["requireHost"]
>[0];

/**
 * evo §37 B: the Host-facing reads and facts of the run watchdog. The rule
 * itself runs on the Host (`agent-host/src/run-watchdog.ts`); the Kernel owns
 * the live thresholds ({@link RunGuardPolicy}) and the queue it compares
 * against, and records the no-progress warning as an activity fact.
 */
export class RunWatchdogService {
  readonly #database: DatabaseSync;
  readonly #events: RoomEventWriter;
  readonly #options: RuntimeTrajectoryServiceOptions;
  readonly #policy: RunGuardPolicy;

  constructor(
    options: RuntimeTrajectoryServiceOptions,
    events: RoomEventWriter,
    policy: RunGuardPolicy,
  ) {
    this.#database = options.database;
    this.#events = events;
    this.#options = options;
    this.#policy = policy;
  }

  /**
   * The thresholds and whether other work for the same instance is already
   * queued (any Room: an instance has one serial lane).
   */
  read(host: HostContext, input: RunWatchdogReadInput): RunWatchdogContext {
    const authenticated = this.#options.requireHost(host);
    const command = RunWatchdogReadInputSchema.parse(input);
    const activation = this.#database
      .prepare("SELECT participant_id FROM activations WHERE activation_id = ?")
      .get(command.activationId);
    if (activation === undefined)
      throw new NotFoundError(
        `activation ${command.activationId} was not found`,
      );
    const participantId = text(activation, "participant_id");
    this.#options.requireHostParticipant(authenticated, participantId);
    const queued = this.#database
      .prepare(
        "SELECT 1 FROM activations WHERE participant_id = ? AND state = 'queued' AND activation_id <> ? LIMIT 1",
      )
      .get(participantId, command.activationId);
    return RunWatchdogContextSchema.parse({
      ...this.#policy.watchdog(),
      queuedWorkWaiting: queued !== undefined,
    });
  }

  /**
   * The no-progress warning is an activity fact, not a failure: one
   * `run.watchdog_warning` event per RunAttempt, idempotent. It never changes
   * the run, the Activation or any Task.
   */
  recordWarning(host: HostContext, input: RunWatchdogWarningInput): void {
    const authenticated = this.#options.requireHost(host);
    const command = RunWatchdogWarningInputSchema.parse(input);
    inImmediateTransaction(this.#database, () => {
      const runAttempt = this.#database
        .prepare("SELECT * FROM run_attempts WHERE run_attempt_id = ?")
        .get(command.runAttemptId);
      if (runAttempt === undefined)
        throw new NotFoundError(
          `run attempt ${command.runAttemptId} was not found`,
        );
      this.#options.requireHostParticipant(
        authenticated,
        text(runAttempt, "participant_id"),
      );
      if (text(runAttempt, "host_id") !== authenticated.hostId)
        throw new ForbiddenError(
          `host ${authenticated.hostId} does not own run attempt ${command.runAttemptId}`,
        );
      const roomId = text(runAttempt, "room_id");
      const idempotencyKey = `run.watchdog_warning:${command.runAttemptId}`;
      if (
        this.#database
          .prepare(
            "SELECT 1 FROM room_events WHERE room_id = ? AND idempotency_key = ?",
          )
          .get(roomId, idempotencyKey) !== undefined
      )
        return;
      this.#events.append({
        actorId: SYSTEM_PRINCIPAL_ID,
        aggregateId: command.runAttemptId,
        aggregateType: "run_attempt",
        idempotencyKey,
        payload: {
          activationId: text(runAttempt, "activation_id"),
          hostId: authenticated.hostId,
          kind: "no_progress",
          participantId: text(runAttempt, "participant_id"),
          runAttemptId: command.runAttemptId,
          thresholdMs: command.thresholdMs,
        },
        roomId,
        type: "run.watchdog_warning",
      });
    });
  }
}
