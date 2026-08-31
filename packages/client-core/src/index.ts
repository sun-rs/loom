import type { RahClient } from "@rah-os/client-sdk";
import type {
  ClientRoomSyncResponse,
  Message,
  RoomMembership,
  RoomEvent,
  RoomSnapshot,
} from "@rah-os/protocol";

export type EnsureRoomMembershipResult =
  | { changed: false; membership: RoomMembership }
  | { changed: true; event: RoomEvent; membership: RoomMembership };

export type EnsureRoomMembershipRemovedResult =
  | { changed: false; removedPrincipalId: string }
  | { changed: true; event: RoomEvent; removedPrincipalId: string };

export async function ensureRoomMembership(
  client: RahClient,
  input: {
    agentDefinitionId: string;
    basedOnRoomSeq: number;
    idempotencyKey: string;
    participantId: string;
    roomId: string;
  },
): Promise<EnsureRoomMembershipResult> {
  const existing = await findRoomMembership(
    client,
    input.roomId,
    input.participantId,
  );
  if (existing !== undefined) return { changed: false, membership: existing };

  try {
    const result = await client.request("agent.onboard", {
      agentDefinitionId: input.agentDefinitionId,
      basedOnRoomSeq: input.basedOnRoomSeq,
      idempotencyKey: input.idempotencyKey,
      roomId: input.roomId,
    });
    return result.deduplicated
      ? { changed: false, membership: result.membership }
      : {
          changed: true,
          event: result.event,
          membership: result.membership,
        };
  } catch (failure) {
    try {
      const reconciled = await findRoomMembership(
        client,
        input.roomId,
        input.participantId,
      );
      if (reconciled !== undefined) {
        return { changed: false, membership: reconciled };
      }
    } catch {
      // Preserve the mutation failure when reconciliation itself is unavailable.
    }
    throw failure;
  }
}

export async function ensureRoomMembershipRemoved(
  client: RahClient,
  input: {
    basedOnRoomSeq: number;
    idempotencyKey: string;
    participantId: string;
    roomId: string;
  },
): Promise<EnsureRoomMembershipRemovedResult> {
  const existing = await findRoomMembership(
    client,
    input.roomId,
    input.participantId,
  );
  if (existing === undefined) {
    return { changed: false, removedPrincipalId: input.participantId };
  }

  try {
    const result = await client.request("room.member.remove", {
      basedOnRoomSeq: input.basedOnRoomSeq,
      idempotencyKey: input.idempotencyKey,
      principalId: input.participantId,
      roomId: input.roomId,
    });
    return result.deduplicated
      ? { changed: false, removedPrincipalId: result.removedPrincipalId }
      : {
          changed: true,
          event: result.event,
          removedPrincipalId: result.removedPrincipalId,
        };
  } catch (failure) {
    try {
      const reconciled = await findRoomMembership(
        client,
        input.roomId,
        input.participantId,
      );
      if (reconciled === undefined) {
        return { changed: false, removedPrincipalId: input.participantId };
      }
    } catch {
      // Preserve the mutation failure when reconciliation itself is unavailable.
    }
    throw failure;
  }
}

async function findRoomMembership(
  client: RahClient,
  roomId: string,
  participantId: string,
): Promise<RoomMembership | undefined> {
  const result = await client.request("room.member.list", { roomId });
  return result.memberships.find(
    (membership) => membership.principalId === participantId,
  );
}

export type RoomProjection = {
  acknowledgedThrough: number;
  cursor: number;
  events: readonly RoomEvent[];
  latestRoomSeq: number;
  roomId: string;
  snapshot: RoomSnapshot | null;
};

export type RoomCatchUpResult = {
  caughtUp: boolean;
  pages: number;
  state: RoomProjection;
};

export type MessageCatchUpResult = {
  complete: boolean;
  cursorAfter: number;
  cursorBefore: number;
  hasEarlier: boolean;
  messages: readonly Message[];
  pages: number;
};

/** Raft's bounded latest/backward Message window. */
export const RAFT_MESSAGE_PAGE_SIZE = 50;

export async function listMessagesBounded(
  client: RahClient,
  options: {
    afterSeq?: number;
    limit?: number;
    maxPages?: number;
    roomId: string;
    signal?: AbortSignal;
    threadId?: string;
  },
): Promise<MessageCatchUpResult> {
  const limit = options.limit ?? RAFT_MESSAGE_PAGE_SIZE;
  const maxPages = options.maxPages ?? 10;
  const afterSeq = options.afterSeq ?? 0;
  if (!Number.isInteger(afterSeq) || afterSeq < 0) {
    throw new Error("Message afterSeq must be a non-negative integer");
  }
  if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
    throw new Error("Message page limit must be between 1 and 500");
  }
  if (!Number.isInteger(maxPages) || maxPages <= 0 || maxPages > 100) {
    throw new Error("Message maxPages must be between 1 and 100");
  }

  const messages: Message[] = [];
  let cursorAfter = afterSeq;
  let cursorBefore = afterSeq;
  let hasEarlier = afterSeq > 0;
  for (let pages = 1; pages <= maxPages; pages += 1) {
    const page = await client.request(
      "message.list",
      {
        afterSeq: cursorAfter,
        limit,
        roomId: options.roomId,
        ...(options.threadId === undefined
          ? {}
          : { threadId: options.threadId }),
      },
      options.signal === undefined ? undefined : { signal: options.signal },
    );
    let previousSequence = cursorAfter;
    for (const message of page.messages) {
      if (message.roomId !== options.roomId) {
        throw new Error("Message page belongs to another Room");
      }
      if (
        options.threadId !== undefined &&
        message.threadId !== options.threadId
      ) {
        throw new Error("Message page belongs to another Thread");
      }
      if (message.roomSeq <= previousSequence) {
        throw new Error("Message page is not strictly ordered");
      }
      previousSequence = message.roomSeq;
      messages.push(message);
    }
    const expectedCursor = page.messages.at(-1)?.roomSeq ?? cursorAfter;
    if (page.cursorAfter !== expectedCursor) {
      throw new Error("Message page cursor does not match its contents");
    }
    const expectedCursorBefore = page.messages.at(0)?.roomSeq ?? cursorAfter;
    if (page.cursorBefore !== expectedCursorBefore) {
      throw new Error(
        "Message page backward cursor does not match its contents",
      );
    }
    if (messages.length === page.messages.length) {
      cursorBefore = page.cursorBefore;
      hasEarlier = page.hasMoreBefore;
    }
    if (!page.hasMoreAfter) {
      return Object.freeze({
        complete: true,
        cursorAfter: page.cursorAfter,
        cursorBefore,
        hasEarlier,
        messages: Object.freeze(messages),
        pages,
      });
    }
    if (page.cursorAfter === cursorAfter) {
      throw new Error("Message pagination made no progress");
    }
    cursorAfter = page.cursorAfter;
  }

  return Object.freeze({
    complete: false,
    cursorAfter,
    cursorBefore,
    hasEarlier,
    messages: Object.freeze(messages),
    pages: maxPages,
  });
}

export class MessageSession {
  readonly #client: RahClient;
  readonly #roomId: string;
  readonly #threadId: string | undefined;
  #complete = false;
  #cursorAfter = 0;
  #cursorBefore = 0;
  #hasEarlier = false;
  #initialized = false;
  #messages: readonly Message[] = Object.freeze([]);

  constructor(options: {
    client: RahClient;
    roomId: string;
    threadId?: string;
  }) {
    this.#client = options.client;
    this.#roomId = options.roomId;
    this.#threadId = options.threadId;
  }

  get state(): Omit<MessageCatchUpResult, "pages"> {
    return Object.freeze({
      complete: this.#complete,
      cursorAfter: this.#cursorAfter,
      cursorBefore: this.#cursorBefore,
      hasEarlier: this.#hasEarlier,
      messages: this.#messages,
    });
  }

  async syncUntilCurrent(
    options: {
      limit?: number;
      maxPages?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<MessageCatchUpResult> {
    if (!this.#initialized) {
      const limit = options.limit ?? RAFT_MESSAGE_PAGE_SIZE;
      if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
        throw new Error("Message page limit must be between 1 and 500");
      }
      const page = await this.#client.request(
        "message.list",
        {
          limit,
          roomId: this.#roomId,
          ...(this.#threadId === undefined ? {} : { threadId: this.#threadId }),
        },
        options.signal === undefined ? undefined : { signal: options.signal },
      );
      validateMessagePage(page.messages, {
        roomId: this.#roomId,
        ...(this.#threadId === undefined ? {} : { threadId: this.#threadId }),
      });
      const expectedBefore = page.messages.at(0)?.roomSeq ?? 0;
      const expectedAfter = page.messages.at(-1)?.roomSeq ?? 0;
      if (
        page.cursorBefore !== expectedBefore ||
        page.cursorAfter !== expectedAfter
      ) {
        throw new Error(
          "Latest Message window cursor does not match its contents",
        );
      }
      this.#initialized = true;
      this.#complete = !page.hasMoreAfter;
      this.#cursorBefore = page.cursorBefore;
      this.#cursorAfter = page.cursorAfter;
      this.#hasEarlier = page.hasMoreBefore;
      this.#messages = Object.freeze([...page.messages]);
      return Object.freeze({
        complete: this.#complete,
        cursorAfter: this.#cursorAfter,
        cursorBefore: this.#cursorBefore,
        hasEarlier: this.#hasEarlier,
        messages: this.#messages,
        pages: 1,
      });
    }
    const result = await listMessagesBounded(this.#client, {
      afterSeq: this.#cursorAfter,
      roomId: this.#roomId,
      ...(this.#threadId === undefined ? {} : { threadId: this.#threadId }),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.maxPages === undefined ? {} : { maxPages: options.maxPages }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    this.#complete = result.complete;
    this.#cursorAfter = result.cursorAfter;
    if (result.messages.length > 0) {
      if (this.#messages.length === 0) {
        this.#cursorBefore = result.cursorBefore;
        this.#hasEarlier = result.hasEarlier;
      }
      this.#messages = mergeMessageWindow(this.#messages, result.messages);
    }
    return Object.freeze({
      complete: result.complete,
      cursorAfter: this.#cursorAfter,
      cursorBefore: this.#cursorBefore,
      hasEarlier: this.#hasEarlier,
      messages: this.#messages,
      pages: result.pages,
    });
  }

  async loadEarlier(
    options: { limit?: number; signal?: AbortSignal } = {},
  ): Promise<MessageCatchUpResult> {
    if (!this.#initialized) return this.syncUntilCurrent(options);
    if (!this.#hasEarlier) {
      return Object.freeze({
        complete: this.#complete,
        cursorAfter: this.#cursorAfter,
        cursorBefore: this.#cursorBefore,
        hasEarlier: false,
        messages: this.#messages,
        pages: 0,
      });
    }
    const limit = options.limit ?? RAFT_MESSAGE_PAGE_SIZE;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 500) {
      throw new Error("Message page limit must be between 1 and 500");
    }
    const requestedBefore = this.#cursorBefore;
    const page = await this.#client.request(
      "message.list",
      {
        beforeSeq: requestedBefore,
        limit,
        roomId: this.#roomId,
        ...(this.#threadId === undefined ? {} : { threadId: this.#threadId }),
      },
      options.signal === undefined ? undefined : { signal: options.signal },
    );
    validateMessagePage(page.messages, {
      beforeSeq: requestedBefore,
      roomId: this.#roomId,
      ...(this.#threadId === undefined ? {} : { threadId: this.#threadId }),
    });
    const expectedBefore = page.messages.at(0)?.roomSeq ?? requestedBefore;
    const expectedAfter = page.messages.at(-1)?.roomSeq ?? requestedBefore;
    if (
      page.cursorBefore !== expectedBefore ||
      page.cursorAfter !== expectedAfter
    ) {
      throw new Error(
        "Earlier Message window cursor does not match its contents",
      );
    }
    if (page.hasMoreBefore && page.cursorBefore === requestedBefore) {
      throw new Error("Earlier Message pagination made no progress");
    }
    this.#cursorBefore = page.cursorBefore;
    this.#hasEarlier = page.hasMoreBefore;
    this.#messages = mergeMessageWindow(page.messages, this.#messages);
    return Object.freeze({
      complete: this.#complete,
      cursorAfter: this.#cursorAfter,
      cursorBefore: this.#cursorBefore,
      hasEarlier: this.#hasEarlier,
      messages: this.#messages,
      pages: 1,
    });
  }
}

function validateMessagePage(
  messages: readonly Message[],
  expected: { beforeSeq?: number; roomId: string; threadId?: string },
): void {
  let previousSequence = 0;
  for (const message of messages) {
    if (message.roomId !== expected.roomId) {
      throw new Error("Message page belongs to another Room");
    }
    if (
      expected.threadId !== undefined &&
      message.threadId !== expected.threadId
    ) {
      throw new Error("Message page belongs to another Thread");
    }
    if (message.roomSeq <= previousSequence) {
      throw new Error("Message page is not strictly ordered");
    }
    if (
      expected.beforeSeq !== undefined &&
      message.roomSeq >= expected.beforeSeq
    ) {
      throw new Error("Earlier Message page crossed its before cursor");
    }
    previousSequence = message.roomSeq;
  }
}

function mergeMessageWindow(
  left: readonly Message[],
  right: readonly Message[],
): readonly Message[] {
  const byId = new Map(left.map((message) => [message.messageId, message]));
  for (const message of right) byId.set(message.messageId, message);
  return Object.freeze(
    [...byId.values()].sort(
      (first, second) =>
        first.roomSeq - second.roomSeq ||
        first.messageId.localeCompare(second.messageId),
    ),
  );
}

export type ConsumerIdStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function loadOrCreateConsumerId(options: {
  createId: () => string;
  storage?: ConsumerIdStorage;
  storageKey: string;
}): string {
  try {
    const existing = options.storage?.getItem(options.storageKey)?.trim();
    if (existing !== undefined && existing.length > 0) return existing;
  } catch {
    // Storage can be unavailable in private/opaque browser contexts.
  }

  const created = options.createId().trim();
  if (created.length === 0) throw new Error("consumer identity is required");
  try {
    options.storage?.setItem(options.storageKey, created);
  } catch {
    // An in-memory identity remains safe; only reload continuity is lost.
  }
  return created;
}

export function createEmptyRoomProjection(roomId: string): RoomProjection {
  return Object.freeze({
    acknowledgedThrough: 0,
    cursor: 0,
    events: Object.freeze([]),
    latestRoomSeq: 0,
    roomId,
    snapshot: null,
  });
}

export function applyRoomSync(
  state: RoomProjection,
  delivery: ClientRoomSyncResponse,
  context: { afterSeq: number },
): RoomProjection {
  const { afterSeq } = context;
  if (!Number.isInteger(afterSeq) || afterSeq < 0) {
    throw new Error("Room sync afterSeq must be a non-negative integer");
  }
  if (afterSeq > state.cursor) {
    throw new Error(
      `Room sync gap: local cursor ${String(state.cursor)}, request starts at ${String(afterSeq)}`,
    );
  }
  if (
    delivery.snapshot !== null &&
    delivery.snapshot.room.roomId !== state.roomId
  ) {
    throw new Error("Room sync snapshot belongs to another Room");
  }
  if (delivery.snapshot !== null && afterSeq !== 0) {
    throw new Error("Room sync snapshot is only valid for a zero-based replay");
  }
  if (state.snapshot === null && afterSeq === 0 && delivery.snapshot === null) {
    throw new Error("Room sync cold bootstrap requires a snapshot");
  }
  if (state.snapshot === null && afterSeq !== 0) {
    throw new Error("Room sync cannot continue before snapshot bootstrap");
  }
  if (delivery.cursorAfter < afterSeq) {
    throw new Error("Room sync delivery cursor precedes the requested cursor");
  }
  if (delivery.latestRoomSeq < state.latestRoomSeq) {
    throw new Error("Room sync latest sequence moved backwards");
  }

  const bySequence = new Map(
    state.events.map((event) => [event.roomSeq, event]),
  );
  const events = [...state.events];
  let cursor = state.cursor;
  let previousIncomingSequence = afterSeq;

  for (const incoming of delivery.events) {
    if (incoming.roomId !== state.roomId) {
      throw new Error("Room sync event belongs to another Room");
    }
    if (incoming.roomSeq !== previousIncomingSequence + 1) {
      throw new Error(
        `Room sync gap before sequence ${String(incoming.roomSeq)}`,
      );
    }
    previousIncomingSequence = incoming.roomSeq;
    if (incoming.roomSeq <= state.cursor) {
      const known = bySequence.get(incoming.roomSeq);
      if (known === undefined || known.eventId !== incoming.eventId) {
        throw new Error(
          `Room sync contains divergent history at sequence ${String(incoming.roomSeq)}`,
        );
      }
      continue;
    }
    if (incoming.roomSeq !== cursor + 1) {
      throw new Error(
        `Room sync gap before sequence ${String(incoming.roomSeq)}`,
      );
    }
    events.push(incoming);
    bySequence.set(incoming.roomSeq, incoming);
    cursor = incoming.roomSeq;
  }

  const deliveredThrough = delivery.events.at(-1)?.roomSeq ?? context.afterSeq;
  if (delivery.cursorAfter !== deliveredThrough) {
    throw new Error("Room sync delivery cursor does not match its event page");
  }
  if (
    cursor === state.cursor &&
    delivery.latestRoomSeq === state.latestRoomSeq &&
    (delivery.snapshot === null || delivery.snapshot === state.snapshot)
  ) {
    return state;
  }
  return Object.freeze({
    ...state,
    cursor,
    events: Object.freeze(events),
    latestRoomSeq: Math.max(state.latestRoomSeq, delivery.latestRoomSeq),
    snapshot: delivery.snapshot ?? state.snapshot,
  });
}

export class RoomSession {
  readonly #client: RahClient;
  readonly #consumerId: string;
  readonly #roomId: string;
  #state: RoomProjection;
  #syncTail: Promise<void> = Promise.resolve();

  constructor(options: {
    client: RahClient;
    consumerId: string;
    roomId: string;
  }) {
    this.#client = options.client;
    this.#consumerId = options.consumerId;
    this.#roomId = options.roomId;
    this.#state = createEmptyRoomProjection(options.roomId);
  }

  get state(): RoomProjection {
    return this.#state;
  }

  async syncUntilCurrent(
    options: {
      limit?: number;
      maxPages?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<RoomCatchUpResult> {
    const maxPages = options.maxPages ?? 4;
    if (!Number.isInteger(maxPages) || maxPages <= 0 || maxPages > 100) {
      throw new Error("Room sync maxPages must be between 1 and 100");
    }

    for (let pages = 1; pages <= maxPages; pages += 1) {
      const cursorBefore = this.#state.cursor;
      const state = await this.syncOnce({
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      if (state.cursor >= state.latestRoomSeq) {
        return Object.freeze({ caughtUp: true, pages, state });
      }
      if (state.cursor === cursorBefore) {
        throw new Error("Room sync made no progress while behind latest");
      }
    }

    return Object.freeze({
      caughtUp: false,
      pages: maxPages,
      state: this.#state,
    });
  }

  syncOnce(
    options: {
      limit?: number;
      signal?: AbortSignal;
    } = {},
  ): Promise<RoomProjection> {
    const result = this.#syncTail.then(() => this.#syncOnceSerial(options));
    this.#syncTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #syncOnceSerial(options: {
    limit?: number;
    signal?: AbortSignal;
  }): Promise<RoomProjection> {
    const afterSeq = this.#state.cursor;
    const delivery = await this.#client.request(
      "room.sync",
      {
        afterSeq,
        consumerId: this.#consumerId,
        roomId: this.#roomId,
        ...(options.limit === undefined ? {} : { limit: options.limit }),
      },
      options.signal === undefined ? undefined : { signal: options.signal },
    );
    const projected = applyRoomSync(this.#state, delivery, { afterSeq });
    const receipt = await this.#client.request(
      "room.acknowledge",
      {
        consumerId: this.#consumerId,
        roomId: this.#roomId,
        throughSeq: delivery.cursorAfter,
      },
      options.signal === undefined ? undefined : { signal: options.signal },
    );
    if (receipt.acknowledgedThrough !== delivery.cursorAfter) {
      throw new Error(
        "Room acknowledgement did not confirm the delivery cursor",
      );
    }
    this.#state = Object.freeze({
      ...projected,
      acknowledgedThrough: Math.max(
        projected.acknowledgedThrough,
        receipt.acknowledgedThrough,
      ),
    });
    return this.#state;
  }
}

export type RoomMutationSequenceSession = {
  syncUntilCurrent(options?: { maxPages?: number }): Promise<{
    caughtUp: boolean;
    state: { latestRoomSeq: number };
  }>;
};

export async function runRoomMutationAtLatest<Result>(input: {
  maxAttempts?: number;
  mutate: (basedOnRoomSeq: number) => Promise<Result>;
  session: RoomMutationSequenceSession;
}): Promise<Result> {
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("Room mutation maxAttempts must be between 1 and 10");
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const caughtUp = await input.session.syncUntilCurrent({ maxPages: 10 });
    if (!caughtUp.caughtUp) {
      throw new Error("Room mutation requires a complete causal projection");
    }
    try {
      return await input.mutate(caughtUp.state.latestRoomSeq);
    } catch (failure) {
      if (!isStaleContextFailure(failure) || attempt === maxAttempts) {
        throw failure;
      }
    }
  }
  throw new Error("Room mutation retry loop terminated unexpectedly");
}

function isStaleContextFailure(
  failure: unknown,
): failure is { code: "stale_context"; status: 409 } {
  return (
    failure !== null &&
    typeof failure === "object" &&
    "code" in failure &&
    failure.code === "stale_context" &&
    "status" in failure &&
    failure.status === 409
  );
}
