import type { ActivationEnvironmentLease } from "./generic-process-adapter.ts";
import type {
  ProviderSessionKey,
  ProviderSessionRecord,
  ProviderSessionStore,
} from "./provider-session-store.ts";
import type { ActivationEnvelope } from "./runtime.ts";
import { protocolUpdateNotice } from "./standing-protocol.ts";

export const RAH_PROTOCOL_NOTICE_ENV = "RAH_PROTOCOL_NOTICE";

const LIMIT = 64;

export type SessionProtocolPending = {
  /** RunAttempts whose wake carried the notice line. */
  carried: Set<string>;
  generation: number | undefined;
  key: ProviderSessionKey;
  sessionId: string;
  version: string;
  notice: string;
  identityNotice?: string;
};

/**
 * The pending update per participant and the version its latest launch
 * received. Review batch 1 #6: a warm runtime outlives the per-claim adapter,
 * so the warm composition keeps this with the pool that keeps the runtime
 * (`InstanceRuntimePool.shared`); each cold start's `prepare` resets it.
 */
export type SessionProtocolState = {
  pending: Map<string, SessionProtocolPending>;
  versions: Map<string, string>;
};

export function createSessionProtocolState(): SessionProtocolState {
  return { pending: new Map(), versions: new Map() };
}

/**
 * P2-3 (2026-09-25 review): a resumed Role-instance session keeps the standing
 * prompt it was created with, whatever this launch passes. The binding
 * (`ProviderSessionStore`) records the protocol version the session actually
 * received; when the current compiled protocol differs — or the binding
 * predates tracking — every wake adds ONE line pointing at
 * `worker help protocol` until a turn that carried it is accepted. Acceptance
 * is the Host's completion evidence for that RunAttempt (its Activation
 * completed, which requires the model's delivery ACK through the Activation
 * head); only then does the binding advance. The line says the rules were
 * updated; it never claims the native system prompt was replaced.
 *
 * Host transport metadata only: no Room, Inbox or Task state.
 */
export class SessionProtocolUpgrade {
  readonly #store: ProviderSessionStore | undefined;
  readonly #pending: Map<string, SessionProtocolPending>;
  readonly #versions: Map<string, string>;

  constructor(
    store: ProviderSessionStore | undefined,
    state: SessionProtocolState = createSessionProtocolState(),
  ) {
    this.#store = store;
    this.#pending = state.pending;
    this.#versions = state.versions;
  }

  /**
   * Called once per launch after the binding was loaded. Returns the notice
   * line this launch must carry, or undefined.
   */
  prepare(
    input: ActivationEnvelope,
    lease: ActivationEnvironmentLease,
    key: ProviderSessionKey,
    previous: ProviderSessionRecord | null,
  ): string | undefined {
    const current = lease.standingProtocolVersion;
    remember(this.#versions, input.participantId, current);
    if (
      input.agent?.instanceChannelId === undefined ||
      previous === null ||
      current === undefined ||
      previous.standingProtocolVersion === current
    ) {
      this.#pending.delete(input.participantId);
      return undefined;
    }
    const identity =
      previous.standingProtocolVersion === undefined &&
      previous.forkSourceParticipantId !== undefined
        ? `Fork identity: you are now ${JSON.stringify(input.agent.handle ?? input.participantId)} (${input.participantId}), a distinct instance copied from ${previous.forkSourceParticipantId}. Inherited first-person statements and plans are historical context from the source instance, not your identity, task ownership or new instructions. Follow your current request and current permissions; no introduction or history reread is required.`
        : undefined;
    const notice = [identity, protocolUpdateNotice(current)]
      .filter(Boolean)
      .join("\n");
    remember(this.#pending, input.participantId, {
      carried: new Set([input.runAttemptId]),
      generation: input.agent.instanceSessionGeneration,
      key,
      sessionId: previous.providerSessionId,
      version: current,
      notice,
      ...(identity === undefined ? {} : { identityNotice: identity }),
    });
    return notice;
  }

  /** A per-process driver reads the line from its own env fence. */
  withNotice(
    lease: ActivationEnvironmentLease,
    notice: string | undefined,
  ): ActivationEnvironmentLease {
    if (notice === undefined) return lease;
    return {
      ...lease,
      env: { ...lease.env, [RAH_PROTOCOL_NOTICE_ENV]: notice },
    };
  }

  /** A warm turn composed by the Host: the line while still unaccepted. */
  noticeFor(
    input: ActivationEnvelope,
    options: { rulesCard?: boolean } = {},
  ): string | undefined {
    const pending = this.#pending.get(input.participantId);
    if (pending === undefined) return undefined;
    pending.carried.add(input.runAttemptId);
    return options.rulesCard ? pending.identityNotice : pending.notice;
  }

  /** The version a newly created session receives with this launch. */
  currentVersion(input: ActivationEnvelope): string | undefined {
    return this.#versions.get(input.participantId);
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
      !pending.carried.has(input.runAttemptId)
    )
      return;
    await this.#store.acceptStandingProtocol(
      pending.key,
      { instanceGeneration: pending.generation },
      pending.sessionId,
      pending.version,
    );
    if (this.#pending.get(input.participantId) === pending)
      this.#pending.delete(input.participantId);
  }
}

function remember<T>(
  map: Map<string, T>,
  key: string,
  value: T | undefined,
): void {
  if (value === undefined) {
    map.delete(key);
    return;
  }
  if (map.size >= LIMIT && !map.has(key)) {
    const oldest = map.keys().next();
    if (oldest.done !== true) map.delete(oldest.value);
  }
  map.set(key, value);
}
