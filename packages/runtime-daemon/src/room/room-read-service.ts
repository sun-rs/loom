import type {
  RoomBootstrapReadRequest,
  RoomBootstrapReadResponse,
  RoomEventReadRequest,
  RoomEventReadResponse,
  RoomInboxReadRequest,
  RoomInboxReadResponse,
  RoomOlderMessagesReadRequest,
  RoomOlderMessagesReadResponse,
} from "@rah/runtime-protocol";
import {
  toRoomEventDto,
  validateRoomBootstrapReadRequest,
  validateRoomEventReadRequest,
  validateRoomInboxReadRequest,
  validateRoomOlderMessagesReadRequest,
} from "@rah/runtime-protocol";

import type { DeviceAuthPrincipal } from "../device-auth";
import { RoomActorResolver } from "./room-actor";
import { ROOM_READ_RESPONSE_BYTE_LIMIT } from "./room-read-budget";
import { RoomReadCursorCodec } from "./room-read-cursor";
import type { RoomCursorKeyMaterial } from "./room-read-cursor";
import { RoomDomainError, roomError } from "./room-errors";
import type { RoomLedger } from "./room-ledger";

export interface RoomReadServiceOptions {
  cursorKey: RoomCursorKeyMaterial;
  responseByteLimit?: number;
}

export { ROOM_READ_RESPONSE_BYTE_LIMIT } from "./room-read-budget";

/**
 * Authenticated application port for Room reads. It is intentionally not an
 * HTTP router: transport adapters may call this owner only after device auth,
 * and cannot supply an actor or arbitrary Inbox participant.
 */
export class RoomReadService {
  readonly #ledger: RoomLedger;
  readonly #actors: RoomActorResolver;
  readonly #cursors: RoomReadCursorCodec;
  readonly #responseByteLimit: number;

  constructor(ledger: RoomLedger, options: RoomReadServiceOptions) {
    this.#ledger = ledger;
    this.#actors = new RoomActorResolver(ledger);
    this.#cursors = new RoomReadCursorCodec(options.cursorKey);
    this.#responseByteLimit = options.responseByteLimit ?? ROOM_READ_RESPONSE_BYTE_LIMIT;
    if (
      !Number.isSafeInteger(this.#responseByteLimit) ||
      this.#responseByteLimit < 1_024 ||
      this.#responseByteLimit > ROOM_READ_RESPONSE_BYTE_LIMIT
    ) {
      throw roomError(
        "invalid_argument",
        `Room read responseByteLimit must be between 1024 and ${ROOM_READ_RESPONSE_BYTE_LIMIT}`,
      );
    }
  }

  bootstrap(
    principal: DeviceAuthPrincipal | null,
    rawRequest: RoomBootstrapReadRequest,
  ): RoomBootstrapReadResponse {
    const actor = this.#actors.resolve(principal);
    const request = this.#validate(() => validateRoomBootstrapReadRequest(rawRequest));
    const result = this.#ledger.syncRoom(actor.principalId, {
      roomId: request.roomId,
      bootstrap: "latest",
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
    });
    if (result.mode !== "latest_bootstrap") {
      throw roomError("conflict", "Room ledger returned an invalid bootstrap projection");
    }
    const subject = this.#cursors.subject(actor.principalId);
    const recentMessages = [...result.recentMessages];
    const initialAnchor = recentMessages[0]?.roomSeq ?? result.throughSeq + 1;
    const hadMessagesBeforeInitialWindow = this.#ledger.listMessages(
      actor.principalId,
      request.roomId,
      {
        beforeRoomSeq: initialAnchor,
        throughRoomSeq: result.throughSeq,
        limit: 1,
      },
    ).messages.length > 0;
    let removedMessages = 0;
    const buildResponse = (): RoomBootstrapReadResponse => {
      const firstMessage = recentMessages[0];
      const hasOlderMessages = removedMessages > 0 || hadMessagesBeforeInitialWindow;
      return {
        mode: "latest_bootstrap",
        snapshot: result.snapshot,
        snapshotSeq: result.snapshotSeq,
        latestRoomSeq: result.latestRoomSeq,
        recentMessages,
        eventCursor: this.#cursors.encodeEvents({
          roomId: request.roomId,
          subject,
          position: result.snapshotSeq,
        }),
        ...(hasOlderMessages
          ? {
              olderMessagesCursor: this.#cursors.encodeOlderMessages({
                roomId: request.roomId,
                subject,
                anchor: firstMessage?.roomSeq ?? result.throughSeq + 1,
                through: result.throughSeq,
              }),
            }
          : {}),
      };
    };
    let response = buildResponse();
    while (this.#responseBytes(response) > this.#responseByteLimit && recentMessages.length) {
      recentMessages.shift();
      removedMessages += 1;
      response = buildResponse();
    }
    this.#requireResponseBudget(response);
    return response;
  }

  readEvents(
    principal: DeviceAuthPrincipal | null,
    rawRequest: RoomEventReadRequest,
  ): RoomEventReadResponse {
    const actor = this.#actors.resolve(principal);
    const request = this.#validate(() => validateRoomEventReadRequest(rawRequest));
    const subject = this.#cursors.subject(actor.principalId);
    const cursor = this.#cursors.decodeEvents(request.cursor, request.roomId, subject);
    const result = this.#ledger.syncRoom(actor.principalId, {
      roomId: request.roomId,
      afterSeq: cursor.position,
      ...(cursor.through !== undefined ? { throughSeq: cursor.through } : {}),
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
    });
    if (result.mode !== "event_page") {
      throw roomError("conflict", "Room ledger returned an invalid event projection");
    }
    const events = result.events.map((event) => {
      try {
        return toRoomEventDto(event);
      } catch {
        throw roomError("conflict", "Room event violates the client transport contract");
      }
    });
    const acceptedEvents = [...events];
    const buildResponse = (): RoomEventReadResponse => {
      const truncated = acceptedEvents.length < events.length;
      const hasMore = result.hasMore || truncated;
      const position = acceptedEvents.at(-1)?.roomSeq ?? cursor.position;
      return {
        mode: "event_page",
        events: acceptedEvents,
        latestRoomSeq: result.latestRoomSeq,
        hasMore,
        eventCursor: this.#cursors.encodeEvents({
          roomId: request.roomId,
          subject,
          position,
          ...(hasMore ? { through: result.throughSeq } : {}),
        }),
      };
    };
    let response = buildResponse();
    while (this.#responseBytes(response) > this.#responseByteLimit && acceptedEvents.length) {
      acceptedEvents.pop();
      response = buildResponse();
    }
    if (events.length > 0 && acceptedEvents.length === 0) {
      throw roomError(
        "resource_exhausted",
        "A Room event cannot fit within the configured read response budget",
      );
    }
    this.#requireResponseBudget(response);
    return response;
  }

  readOlderMessages(
    principal: DeviceAuthPrincipal | null,
    rawRequest: RoomOlderMessagesReadRequest,
  ): RoomOlderMessagesReadResponse {
    const actor = this.#actors.resolve(principal);
    const request = this.#validate(() => validateRoomOlderMessagesReadRequest(rawRequest));
    const subject = this.#cursors.subject(actor.principalId);
    const cursor = this.#cursors.decodeOlderMessages(request.cursor, request.roomId, subject);
    const result = this.#ledger.listMessages(actor.principalId, request.roomId, {
      beforeRoomSeq: cursor.anchor,
      throughRoomSeq: cursor.through,
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
    });
    if (result.mode !== "backward") {
      throw roomError("conflict", "Room ledger returned an invalid history projection");
    }
    const messages = [...result.messages];
    const buildResponse = (): RoomOlderMessagesReadResponse => {
      const truncated = messages.length < result.messages.length;
      const hasMore = result.hasMore || truncated;
      const anchor = messages[0]?.roomSeq ?? cursor.anchor;
      return {
        mode: "older_messages",
        messages,
        hasMore,
        ...(hasMore
          ? {
              olderMessagesCursor: this.#cursors.encodeOlderMessages({
                roomId: request.roomId,
                subject,
                anchor,
                through: result.throughRoomSeq,
              }),
            }
          : {}),
      };
    };
    let response = buildResponse();
    while (this.#responseBytes(response) > this.#responseByteLimit && messages.length) {
      messages.shift();
      response = buildResponse();
    }
    if (result.messages.length > 0 && messages.length === 0) {
      throw roomError(
        "resource_exhausted",
        "A Room message cannot fit within the configured read response budget",
      );
    }
    this.#requireResponseBudget(response);
    return response;
  }

  readInbox(
    principal: DeviceAuthPrincipal | null,
    rawRequest: RoomInboxReadRequest,
  ): RoomInboxReadResponse {
    const actor = this.#actors.resolve(principal);
    const request = this.#validate(() => validateRoomInboxReadRequest(rawRequest));
    const subject = this.#cursors.subject(actor.principalId);
    const position = request.cursor
      ? this.#cursors.decodeInbox(request.cursor, subject).position
      : 0;
    const items = this.#ledger.listInbox(actor.principalId, {
      afterInboxSeq: position,
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
    });
    const acceptedItems = [...items];
    const buildResponse = (): RoomInboxReadResponse => ({
      items: acceptedItems,
      inboxCursor: this.#cursors.encodeInbox({
        subject,
        position: acceptedItems.at(-1)?.inboxSeq ?? position,
      }),
    });
    let response = buildResponse();
    while (this.#responseBytes(response) > this.#responseByteLimit && acceptedItems.length) {
      acceptedItems.pop();
      response = buildResponse();
    }
    if (items.length > 0 && acceptedItems.length === 0) {
      throw roomError(
        "resource_exhausted",
        "A Room Inbox item cannot fit within the configured read response budget",
      );
    }
    this.#requireResponseBudget(response);
    return response;
  }

  #validate<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof RoomDomainError) throw error;
      throw roomError(
        "invalid_argument",
        error instanceof Error ? error.message : "Room read request validation failed",
      );
    }
  }

  #responseBytes(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value));
  }

  #requireResponseBudget(value: unknown): void {
    if (this.#responseBytes(value) > this.#responseByteLimit) {
      throw roomError("resource_exhausted", "Room read response exceeds the one MiB budget");
    }
  }
}
