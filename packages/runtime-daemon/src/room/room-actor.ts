import type { DeviceAuthPrincipal } from "../device-auth";
import { roomError } from "./room-errors";
import type { RoomLedger } from "./room-ledger";

export interface AuthenticatedRoomActor {
  principalId: string;
  source: "management" | "local" | "trusted_device";
  deviceId?: string;
}

/**
 * Maps daemon-owned device authentication to the single local Human identity.
 * A browser never supplies principalId. Paired devices are alternate clients
 * of the same local owner until a future invitation flow explicitly provisions
 * a different Human principal.
 */
export class RoomActorResolver {
  readonly #ledger: RoomLedger;

  constructor(ledger: RoomLedger) {
    this.#ledger = ledger;
  }

  resolve(principal: DeviceAuthPrincipal | null): AuthenticatedRoomActor {
    if (!principal) {
      throw roomError("unauthenticated", "Room access requires an authenticated device");
    }
    const human = this.#ledger.ensureLocalHumanPrincipal();
    if (principal.kind === "device") {
      return {
        principalId: human.principalId,
        source: "trusted_device",
        deviceId: principal.device.id,
      };
    }
    return {
      principalId: human.principalId,
      source: principal.kind,
    };
  }
}
