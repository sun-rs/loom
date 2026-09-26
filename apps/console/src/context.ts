import type { RahClient } from "@rah-os/client-sdk";
import type { Room } from "@rah-os/protocol";

import type { ConsoleIdentity } from "./model.ts";

export type Connection =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "disconnected"; reason: string };

/** Shared read state for every view; the server remains the only owner. */
export type ConsoleContext = {
  client: RahClient;
  connection: Connection;
  identity: ConsoleIdentity | undefined;
  rooms: readonly Room[];
  roomsLoaded: boolean;
  listeners: Set<() => void>;
};

export function notify(context: ConsoleContext): void {
  for (const listener of context.listeners) listener();
}

export function subscribe(
  context: ConsoleContext,
  listener: () => void,
): () => void {
  context.listeners.add(listener);
  return () => context.listeners.delete(listener);
}
