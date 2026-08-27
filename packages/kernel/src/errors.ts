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

export class IdempotencyConflictError extends ConflictError {}

export class DeliveryProofError extends KernelError {
  constructor(message: string) {
    super(message, "delivery_not_proven");
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
    super(message, "task_not_submitted");
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
