import { BUSINESS_OBLIGATION_UNMET_MARKER } from "@rah-os/protocol";

export class KernelError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class NotFoundError extends KernelError {
  constructor(message: string) {
    super(message, "not_found");
  }
}

export class ForbiddenError extends KernelError {
  constructor(message: string) {
    super(message, "forbidden");
  }
}

export class UnauthenticatedError extends KernelError {
  constructor(message: string) {
    super(message, "unauthenticated");
  }
}

export class ConflictError extends KernelError {
  constructor(message: string) {
    super(message, "conflict");
  }
}

export class LeaseConflictError extends ConflictError {}

export class AgentExecutionPausedError extends ConflictError {}

export class ActivationCancellationRequestedError extends ConflictError {}

export class IdempotencyConflictError extends ConflictError {}

export class MessageForwardSourceError extends KernelError {
  constructor(
    code:
      | "action_source_not_supported"
      | "attachments_not_supported"
      | "forwarded_source_not_supported"
      | "system_source_not_supported",
    message: string,
  ) {
    super(message, code);
  }
}

/**
 * The Activation completion refusal when no delivery confirmation reached the
 * Activation head. A retry scheduled with this error is what the next wake's
 * one-line reminder keys on (`activation-retry-reminder.ts`).
 */
export const ACTIVATION_DELIVERY_NOT_ACKNOWLEDGED =
  "activation delivery is not acknowledged through sequence";

export class DeliveryProofError extends KernelError {
  constructor(message: string) {
    super(message, "delivery_not_proven");
  }

  static notAcknowledgedThrough(seq: number): DeliveryProofError {
    return new DeliveryProofError(
      `${ACTIVATION_DELIVERY_NOT_ACKNOWLEDGED} ${seq}`,
    );
  }
}

/**
 * A reply citing delivered messages (`basedOnRoomSeq`) aimed at a Thread that
 * none of those messages came from. Definite and pre-commit: nothing was
 * published; the next action names the target(s) the messages arrived in.
 */
export class ReplyTargetMismatchError extends KernelError {
  readonly suggestedNextAction: string;
  constructor(message: string, suggestedNextAction: string) {
    super(message, "reply_target_mismatch");
    this.suggestedNextAction = suggestedNextAction;
  }
}

export class ExecutionFencedError extends KernelError {
  constructor(message = "worker execution is no longer current") {
    super(message, "execution_fenced");
  }
}

export class RuntimeTerminationProofError extends KernelError {
  constructor(message: string) {
    super(message, "runtime_termination_not_proven");
  }
}

export class TaskSubmissionProofError extends KernelError {
  constructor(message: string) {
    super(
      `${BUSINESS_OBLIGATION_UNMET_MARKER}: ${message}`,
      "task_not_submitted",
    );
  }
}

export class StaleContextError extends KernelError {
  readonly basedOnRoomSeq: number | undefined;
  readonly latestRoomSeq: number;

  constructor(basedOnRoomSeq: number | undefined, latestRoomSeq: number) {
    super(
      basedOnRoomSeq === undefined
        ? `basedOnRoomSeq is required; latest Room sequence is ${latestRoomSeq}`
        : `mutation was based on Room sequence ${basedOnRoomSeq}, but latest is ${latestRoomSeq}`,
      "stale_context",
    );
    this.basedOnRoomSeq = basedOnRoomSeq;
    this.latestRoomSeq = latestRoomSeq;
  }
}
