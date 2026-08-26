import { ForbiddenError } from "./errors.ts";
import type { Principal } from "./types.ts";

export function requireHumanRoomOwner(principal: Principal): void {
  if (principal.kind !== "human") {
    throw new ForbiddenError("only Human principals can create Rooms");
  }
}
