import type {
  ProviderSessionKey,
  ProviderSessionRecord,
  ProviderSessionStore,
} from "./provider-session-store.ts";
import type { ActivationEnvelope } from "./runtime.ts";
import { renderStandingProtocolCard } from "./standing-protocol.ts";

const LIMIT = 64;

/** Host-private fd3 frame: one native compaction the driver observed. */
export type RuntimeProviderCompaction = Readonly<{
  protocol: "rah-provider-compaction/v1";
  provider: string;
  providerSessionId: string;
  /** 1-based, monotonic within one RunAttempt's driver. */
  ordinal: number;
  compactedCount?: number;
  tokensBefore?: number;
  tokensAfter?: number;
}>;

type Pending = {
  /** The RunAttempt whose wake carried the card. */
  carriedBy: string;
  compactionId: string | undefined;
  instance: boolean;
  generation: number | undefined;
  key: ProviderSessionKey;
  sessionId: string;
};

type Unbound = {
  compactionId: string;
  key: ProviderSessionKey;
  providerSessionId: string;
};

/**
 * S2-c2: re-inject the compact rules card after native compaction, for a
 * runtime with no system-prompt layer (Kimi ACP: `session/new` carries no
 * agent or system slot in kimi-code 0.39.1, so the standing rules are a user
 * turn of the session's first prompt, and kimi-code's compaction summarizes
 * user messages beyond its 20k-token budget).
 *
 * - Every compaction the driver reports is recorded on the session binding
 *   under the Host identity `<runAttemptId>#<ordinal>` (idempotent; a new
 *   session's first-run compaction is replayed once its binding exists).
 * - The next launch whose binding shows a compaction the card has not yet
 *   answered starts its wake with `renderStandingProtocolCard()` — the same
 *   text as `worker help protocol`, not the whole standing prompt. Several
 *   compactions before that wake yield one card.
 * - An outdated standing protocol on a resumed session gets the card too
 *   (instead of the one-line notice: there is no system layer to update).
 * - Acceptance is the Host's completion evidence for a RunAttempt that
 *   carried the card (its Activation completed); only then does the binding
 *   record which compaction the card answered. A compaction during that turn
 *   leaves a newer id, so the following wake carries the card again.
 *
 * Host transport metadata only: no Room, Inbox or Task state.
 */
export class SessionRulesCard {
  readonly #store: ProviderSessionStore | undefined;
  readonly #pending = new Map<string, Pending>();
  readonly #unbound = new Map<string, Unbound[]>();

  constructor(store: ProviderSessionStore | undefined) {
    this.#store = store;
  }

  /**
   * Called once per launch after the binding was loaded. Returns the card
   * this launch's wake must start with, or undefined.
   */
  prepare(
    input: ActivationEnvelope,
    key: ProviderSessionKey,
    previous: ProviderSessionRecord | null,
    protocolOutdated: boolean,
  ): string | undefined {
    const compacted =
      previous?.lastCompactionId !== undefined &&
      previous.lastCompactionId !== previous.rulesCardCompactionId;
    if (previous === null || (!compacted && !protocolOutdated)) {
      this.#pending.delete(input.participantId);
      return undefined;
    }
    remember(this.#pending, input.participantId, {
      carriedBy: input.runAttemptId,
      compactionId: compacted ? previous.lastCompactionId : undefined,
      generation: input.agent?.instanceSessionGeneration,
      instance: input.agent?.instanceChannelId !== undefined,
      key,
      sessionId: previous.providerSessionId,
    });
    return renderStandingProtocolCard();
  }

  /** One compaction frame of `input`'s run, keyed by that run's binding. */
  async observe(
    input: ActivationEnvelope,
    key: ProviderSessionKey | undefined,
    compaction: RuntimeProviderCompaction,
  ): Promise<void> {
    if (this.#store === undefined || key === undefined) return;
    const compactionId = `${input.runAttemptId}#${String(compaction.ordinal)}`;
    const options = sessionOptions(input);
    const recorded = await this.#store.recordCompaction(
      key,
      options,
      compaction.providerSessionId,
      compactionId,
    );
    if (recorded) return;
    // A new session has no binding until its run ends: replay afterwards.
    const queue = this.#unbound.get(input.runAttemptId) ?? [];
    queue.push({
      compactionId,
      key,
      providerSessionId: compaction.providerSessionId,
    });
    remember(this.#unbound, input.runAttemptId, queue);
  }

  /** After this run's session evidence was recorded. */
  async afterBinding(input: ActivationEnvelope): Promise<void> {
    const queue = this.#unbound.get(input.runAttemptId);
    if (this.#store === undefined || queue === undefined) return;
    this.#unbound.delete(input.runAttemptId);
    for (const entry of queue)
      await this.#store.recordCompaction(
        entry.key,
        sessionOptions(input),
        entry.providerSessionId,
        entry.compactionId,
      );
  }

  /** Completion evidence for a RunAttempt; advances only a carrying run. */
  async accept(input: {
    participantId: string;
    runAttemptId: string;
  }): Promise<void> {
    const pending = this.#pending.get(input.participantId);
    if (
      this.#store === undefined ||
      pending === undefined ||
      pending.carriedBy !== input.runAttemptId
    )
      return;
    if (pending.compactionId !== undefined)
      await this.#store.acceptRulesCard(
        pending.key,
        { instance: pending.instance, instanceGeneration: pending.generation },
        pending.sessionId,
        pending.compactionId,
      );
    if (this.#pending.get(input.participantId) === pending)
      this.#pending.delete(input.participantId);
  }
}

function sessionOptions(input: ActivationEnvelope): {
  instance: boolean;
  instanceGeneration: number | undefined;
} {
  return {
    instance: input.agent?.instanceChannelId !== undefined,
    instanceGeneration: input.agent?.instanceSessionGeneration,
  };
}

function remember<T>(map: Map<string, T>, key: string, value: T): void {
  if (map.size >= LIMIT && !map.has(key)) {
    const oldest = map.keys().next();
    if (oldest.done !== true) map.delete(oldest.value);
  }
  map.set(key, value);
}

/** Strict parse of the driver's compaction frame; null for other frames. */
export function parseProviderCompaction(
  value: unknown,
): RuntimeProviderCompaction | null {
  if (
    typeof value !== "object" ||
    value === null ||
    (value as { protocol?: unknown }).protocol !== "rah-provider-compaction/v1"
  )
    return null;
  const frame = value as Record<string, unknown>;
  const counts = ["compactedCount", "tokensBefore", "tokensAfter"] as const;
  const allowed = new Set([
    "protocol",
    "provider",
    "providerSessionId",
    "ordinal",
    ...counts,
  ]);
  if (
    Object.keys(frame).some((field) => !allowed.has(field)) ||
    typeof frame.provider !== "string" ||
    frame.provider === "" ||
    frame.provider.length > 512 ||
    typeof frame.providerSessionId !== "string" ||
    frame.providerSessionId === "" ||
    frame.providerSessionId.length > 4_096 ||
    !Number.isSafeInteger(frame.ordinal) ||
    (frame.ordinal as number) < 1 ||
    counts.some(
      (field) =>
        frame[field] !== undefined &&
        (!Number.isSafeInteger(frame[field]) || (frame[field] as number) < 0),
    )
  )
    throw new Error("invalid runtime compaction frame");
  return {
    protocol: "rah-provider-compaction/v1",
    provider: frame.provider,
    providerSessionId: frame.providerSessionId,
    ordinal: frame.ordinal as number,
    ...Object.fromEntries(
      counts
        .filter((field) => frame[field] !== undefined)
        .map((field) => [field, frame[field] as number]),
    ),
  };
}
