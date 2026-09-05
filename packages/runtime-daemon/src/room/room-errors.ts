export type RoomErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "stale_context"
  | "idempotency_conflict"
  | "resource_exhausted"
  | "unavailable"
  | "invalid_argument";

/** Stable domain error boundary for a future HTTP application port. */
export class RoomDomainError extends Error {
  readonly code: RoomErrorCode;

  constructor(code: RoomErrorCode, message: string) {
    super(message);
    this.name = "RoomDomainError";
    this.code = code;
  }
}

export function roomError(code: RoomErrorCode, message: string): RoomDomainError {
  return new RoomDomainError(code, message);
}
