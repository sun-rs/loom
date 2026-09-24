/**
 * Short Worker refs: the compact wake names a message or Thread by the first
 * UUID block of its canonical id (`message_<uuid>` / `thread_<uuid>`), e.g.
 * `eb064ecc`. The Worker API expands a short ref only inside the caller's
 * joined Rooms and refuses an ambiguous one; a full id always still works.
 * An id that is not in canonical form is never shortened.
 */
const CANONICAL_WORKER_ID =
  /^(?:message|thread)_([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const WORKER_SHORT_REF = /^[0-9a-f]{8}[0-9a-f-]{0,28}$/u;

export function shortWorkerRef(id: string): string {
  return CANONICAL_WORKER_ID.exec(id)?.[1] ?? id;
}

/** True for an 8+ char lowercase hex UUID prefix (never a full typed id). */
export function isWorkerShortRef(value: string): boolean {
  return WORKER_SHORT_REF.test(value);
}
