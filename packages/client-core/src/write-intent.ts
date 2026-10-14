/** Shared Human write intents: causal barrier, frozen idempotency key and explicit unknown-result verification. */
import {
  runRoomMutationAtLatest,
  type RoomMutationSequenceSession,
} from "./index.ts";
import { RahClientError } from "@rah-os/client-sdk";

/** Total attempts (first try plus stale retries), client-core's default. */
export const STALE_RETRY_ATTEMPTS = 3;

export function newIdempotencyKey(action: string): string {
  return `console-${action}-${crypto.randomUUID()}`;
}

/**
 * What one failed request says about itself. A 4xx means this request was
 * refused, so it did not commit; that is proof about the original write only
 * when this request was the first send. Once a send's result was unknown, a
 * later 401/403/404/429 or idempotency conflict (gateway, authentication or a
 * permission check that runs before the Kernel's replay lookup) proves
 * nothing about it. A network error, timeout, 5xx or an unreadable success
 * response leaves this request's own result unknown.
 */
export function classifyWriteFailure(error: unknown): "rejected" | "unknown" {
  return error instanceof RahClientError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408
    ? "rejected"
    : "unknown";
}

function isStaleContext(error: unknown): boolean {
  return (
    error instanceof RahClientError &&
    error.status === 409 &&
    error.code === "stale_context"
  );
}

/**
 * Console actions whose Kernel handler looks up the idempotency key (replay
 * or conflict) before its freshness check, in one transaction. For these
 * only, `stale_context` on an identical replay (same key, payload and basis)
 * proves the original send never committed. Audited at evo HEAD c5cbf98;
 * every other action keeps an unverified result unknown after a stale
 * replay. Evidence (packages/kernel/src; replay line -> freshness line):
 */
export const REPLAY_BEFORE_FRESHNESS: Readonly<Record<string, string>> = {
  "side-create":
    "instance-fork.ts: private creation replay before source freshness, native copy never blindly repeated",
  "side-discard":
    "side-lifecycle.ts: exact replay before freshness; terminal-proof discard completion",
  "instance-fork":
    "instance-fork.ts: committed replay before source/freshness checks; unknown native copies never retried",
  "task-policy":
    "room.update: replay before assertFreshContext in collaboration-service",
  "task-create": "task.create/convert: task-intent replay before freshness",
  "activation-abandon":
    "instance.activation.abandon: role-catalog.ts abandonBlockedActivation replay :540-554 -> fresh :555 (added 2026-09-27, D2-2)",
  "channel-create":
    "room.create: collaboration-service.ts createWorkspaceRoomAtomically replay :479-503 -> basedOnControlRoomSeq check :504-508",
  "direct-open":
    "room.direct.open: collaboration-service.ts replay :987-999 -> basedOnControlRoomSeq check :1022-1026",
  instantiate:
    "role.instantiate: role-catalog.ts replay :267-291 -> fresh :292",
  "instance-remove":
    "room.member.remove: collaboration-service.ts replay :1316-1333 -> fresh :1340",
  message:
    "message.post: collaboration-service.ts postMessage replay :1840-1858 -> #assertFreshContext :1871",
  "role-delete": "role.delete: replay before revision and freshness checks",
  "role-create": "role.create: role-catalog.ts replay :202-213 -> fresh :215",
  "role-revise":
    "role.revise: role-catalog.ts replay :85-96 -> revision check :98, fresh :100",
  "session-reset":
    "instance.session.reset: role-catalog.ts replay :401-415 -> fresh :416",
  "sos-resume":
    "room.sos.resume: room-agent-sos-service.ts replay :332-347 -> fresh :369",
  "sos-stop":
    "room.sos.stop: room-agent-sos-service.ts replay :59-76 -> fresh :94/:122",
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export type IntentState = "idle" | "pending" | "unknown";

export type IntentOutcome<Result> =
  | { kind: "ok"; result: Result }
  | { kind: "rejected"; error: unknown }
  | {
      kind: "unknown";
      error: unknown;
      /**
       * True when an earlier send's result is still unverified and this
       * attempt was refused (e.g. 401 after a cookie renewal, 403, 404, 429,
       * idempotency conflict, or an unconfirmed stale replay): only this
       * verification failed; the original key, payload and basis are kept.
       */
      verificationFailed: boolean;
    }
  | { kind: "busy"; state: IntentState };

export type IntentSpec<Payload, Result> = {
  action: string;
  /** Called for the submit and for every retry of this same intent. */
  onSettled?: (outcome: IntentOutcome<Result>) => void;
  /** Copied and frozen at submit; every attempt sends exactly this. */
  payload: Payload;
  send: (
    payload: Readonly<Payload>,
    basedOnRoomSeq: number,
    idempotencyKey: string,
  ) => Promise<Result>;
  session: RoomMutationSequenceSession;
};

/**
 * For revision-checked writes: no Room basis is read or sent. These
 * endpoints never answer `stale_context`, so the stale retry loop never
 * repeats a send.
 */
const NO_ROOM_BASIS: RoomMutationSequenceSession = {
  syncUntilCurrent: () =>
    Promise.resolve({ caughtUp: true, state: { latestRoomSeq: 0 } }),
};

type Intent = {
  action: string;
  execute: () => Promise<IntentOutcome<unknown>>;
  key: string;
  payload: unknown;
};

/** Slots with a pending or unknown intent, for the leave-page warning. */
const unresolved = new Set<WriteIntentSlot>();

export function hasUnresolvedIntents(): boolean {
  return unresolved.size > 0;
}

/**
 * The Human confirmed leaving: forget the warning for every current slot
 * (their views are unmounted with them; nothing is sent or abandoned).
 */
export function discardUnresolvedIntents(): void {
  for (const slot of unresolved) slot.discard();
  unresolved.clear();
}

/**
 * One submitted write intent per surface (form-level, in memory only). It
 * keeps the frozen payload, the idempotency key and, separately, whether an
 * earlier send is still unverified (`unverified`, with the basis it was sent
 * on) and what the latest request returned (the settled outcome).
 *
 * - First send: success ends the intent; a refusal (4xx) of that very
 *   request, or a failure before anything was sent, returns to idle; any
 *   other failure makes the result unknown.
 * - Unknown: the only ways out are a same-key success (a replay of the
 *   committed write, or its first commit), a `stale_context` on the
 *   identical replay for an action in REPLAY_BEFORE_FRESHNESS (proof it never
 *   committed; it is then re-sent at the current head under the same key),
 *   or an explicit abandon. Any other refusal only fails this verification.
 * A page reload drops the record; the idempotency key goes with it.
 */
export class WriteIntentSlot {
  #discarded = false;
  #intent: Intent | undefined;
  #state: IntentState = "idle";
  #unverified = false;
  readonly #listeners = new Set<(state: IntentState) => void>();

  get state(): IntentState {
    return this.#state;
  }

  /** An earlier send of the current intent may have committed. */
  get unverified(): boolean {
    return this.#unverified;
  }

  /** The submitted intent while pending or unknown. */
  get current(): { action: string; key: string; payload: unknown } | undefined {
    const intent = this.#intent;
    return intent === undefined
      ? undefined
      : { action: intent.action, key: intent.key, payload: intent.payload };
  }

  onChange(listener: (state: IntentState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async submit<Payload, Result>(
    spec: IntentSpec<Payload, Result>,
  ): Promise<IntentOutcome<Result>> {
    if (this.#state !== "idle") return { kind: "busy", state: this.#state };
    const payload = deepFreeze(structuredClone(spec.payload));
    const key = newIdempotencyKey(spec.action);
    const staleProvesUncommitted =
      REPLAY_BEFORE_FRESHNESS[spec.action] !== undefined;
    // Basis of the send whose result is unverified; replays use exactly it.
    let unverifiedSeq: number | undefined;
    const attempt = async (basedOnRoomSeq: number): Promise<Result> => {
      try {
        return await spec.send(payload, basedOnRoomSeq, key);
      } catch (error) {
        if (!this.#unverified && classifyWriteFailure(error) === "unknown") {
          this.#unverified = true;
          unverifiedSeq = basedOnRoomSeq;
        }
        throw error;
      }
    };
    const run = async (): Promise<Result> => {
      if (this.#unverified && unverifiedSeq !== undefined) {
        // Replay the identical request first: a committed write returns its
        // recorded result.
        try {
          return await spec.send(payload, unverifiedSeq, key);
        } catch (error) {
          if (!isStaleContext(error) || !staleProvesUncommitted) throw error;
          // Replay-before-freshness: the original never committed.
          this.#unverified = false;
          unverifiedSeq = undefined;
        }
      }
      return await runRoomMutationAtLatest({
        maxAttempts: STALE_RETRY_ATTEMPTS,
        mutate: attempt,
        session: spec.session,
      });
    };
    const execute = async (): Promise<IntentOutcome<Result>> => {
      const verifying = this.#unverified;
      this.#set("pending");
      let outcome: IntentOutcome<Result>;
      try {
        outcome = { kind: "ok", result: await run() };
        this.#unverified = false;
      } catch (error) {
        outcome = this.#unverified
          ? {
              error,
              kind: "unknown",
              verificationFailed:
                verifying &&
                (classifyWriteFailure(error) === "rejected" ||
                  isStaleContext(error)),
            }
          : { kind: "rejected", error };
      }
      if (outcome.kind === "unknown") this.#set("unknown");
      else {
        this.#intent = undefined;
        this.#set("idle");
      }
      spec.onSettled?.(outcome);
      return outcome;
    };
    this.#intent = { action: spec.action, execute, key, payload };
    return await execute();
  }

  /**
   * An intent whose freshness is an `expectedRevision` inside the frozen
   * payload instead of a Room basis (channel memory changes and switches).
   * Same slot semantics: one key and payload across verification; a first
   * send's 4xx (a revision mismatch is 409) is a refusal, anything else
   * leaves the result unknown until a same-key success or an abandon.
   */
  async submitRevisioned<Payload, Result>(spec: {
    action: string;
    onSettled?: (outcome: IntentOutcome<Result>) => void;
    payload: Payload;
    send: (
      payload: Readonly<Payload>,
      idempotencyKey: string,
    ) => Promise<Result>;
  }): Promise<IntentOutcome<Result>> {
    return await this.submit({
      action: spec.action,
      ...(spec.onSettled === undefined ? {} : { onSettled: spec.onSettled }),
      payload: spec.payload,
      send: (payload, _basedOnRoomSeq, idempotencyKey) =>
        spec.send(payload, idempotencyKey),
      session: NO_ROOM_BASIS,
    });
  }

  /** Re-sends the unknown intent unchanged (verification). */
  async retry(): Promise<IntentOutcome<unknown>> {
    const intent = this.#intent;
    if (this.#state !== "unknown" || intent === undefined) {
      return { kind: "busy", state: this.#state };
    }
    return await intent.execute();
  }

  /** The Human gives up verifying an unknown intent. */
  abandon(): boolean {
    if (this.#state !== "unknown") return false;
    this.#intent = undefined;
    this.#unverified = false;
    this.#set("idle");
    return true;
  }

  /** Leaves the leave-page registry for good (its view is gone). */
  discard(): void {
    this.#discarded = true;
    unresolved.delete(this);
  }

  #set(state: IntentState): void {
    this.#state = state;
    if (state === "idle" || this.#discarded) unresolved.delete(this);
    else unresolved.add(this);
    for (const listener of this.#listeners) listener(state);
  }
}
