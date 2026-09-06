import type {
  DeviceAuthPrincipal,
} from "../device-auth";
import type {
  RoomCommandReceipt,
  RoomHumanCommandOperation,
  RoomHumanCommandRequest,
} from "@rah/runtime-protocol";
import {
  validateRoomHumanCommandRequest,
} from "@rah/runtime-protocol";

import { RoomActorResolver } from "./room-actor";
import { roomError } from "./room-errors";
import type { RoomLedger } from "./room-ledger";

/**
 * Authenticated Human command boundary. The transport never accepts an actor
 * identity; every command is attributed from the daemon-owned device session.
 */
export class RoomCommandService {
  readonly #ledger: RoomLedger;
  readonly #actors: RoomActorResolver;

  constructor(ledger: RoomLedger) {
    this.#ledger = ledger;
    this.#actors = new RoomActorResolver(ledger);
  }

  execute(
    principal: DeviceAuthPrincipal | null,
    operation: RoomHumanCommandOperation,
    rawRequest: unknown,
  ): RoomCommandReceipt {
    const actor = this.#actors.resolve(principal);
    let request: RoomHumanCommandRequest;
    try {
      request = validateRoomHumanCommandRequest(operation, rawRequest);
    } catch (error) {
      throw roomError("invalid_argument", error instanceof Error ? error.message : "Invalid Room command");
    }
    switch (operation) {
      case "create_room": {
        const result = this.#ledger.createRoom(actor.principalId, request as never);
        return this.#receipt(operation, result.event, result.deduplicated);
      }
      case "add_member": {
        const result = this.#ledger.addMember(actor.principalId, request as never);
        return this.#receipt(operation, result.event, result.deduplicated);
      }
      case "post_message": {
        const result = this.#ledger.postMessage(actor.principalId, request as never);
        return this.#receipt(operation, result.event, result.deduplicated);
      }
      case "acknowledge_room": {
        const result = this.#ledger.acknowledgeRoom(actor.principalId, request as never);
        return this.#receipt(operation, result.event, result.deduplicated);
      }
      case "acknowledge_inbox_item": {
        const result = this.#ledger.acknowledgeInboxItem(actor.principalId, request as never);
        return this.#receipt(operation, result.event, result.deduplicated);
      }
      case "acknowledge_message": {
        const result = this.#ledger.acknowledgeMessage(actor.principalId, request as never);
        return this.#receipt(operation, result.event, result.deduplicated);
      }
      case "create_task": {
        const result = this.#ledger.createTask(actor.principalId, request as never);
        return this.#receipt(operation, result.event, result.deduplicated);
      }
      case "accept_task": {
        const result = this.#ledger.acceptTask(actor.principalId, request as never);
        return this.#receipt(operation, result.event, result.deduplicated);
      }
      case "cancel_task": {
        const result = this.#ledger.cancelTask(actor.principalId, request as never);
        return this.#receipt(operation, result.event, result.deduplicated);
      }
    }
  }

  #receipt(
    operation: RoomHumanCommandOperation,
    event: { roomId: string; aggregateId: string; roomSeq: number },
    deduplicated: boolean,
  ): RoomCommandReceipt {
    return {
      operation,
      roomId: event.roomId,
      aggregateId: event.aggregateId,
      roomSeq: event.roomSeq,
      deduplicated,
    };
  }
}
