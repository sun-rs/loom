/**
 * Console transport: the typed SDK in trusted-proxy mode. The gateway drops
 * the placeholder bearer and injects the server-held Human token; the browser
 * never sees it. Throwaway: deleted in phase 4.
 */
import { RoomSession, loadOrCreateConsumerId } from "@rah-os/client-core";
import {
  HttpRahClient,
  RahClientError,
  type RahClient,
} from "@rah-os/client-sdk";

export function createConsoleClient(): RahClient {
  return new HttpRahClient({
    accessToken: () => "trusted-proxy-auth",
    baseUrl: "",
  });
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const sessions = new Map<string, RoomSession>();

/** One cached causal Room session per Room (write paths use it in batch 2). */
export function roomSession(client: RahClient, roomId: string): RoomSession {
  let session = sessions.get(roomId);
  if (session === undefined) {
    const storage = browserStorage();
    session = new RoomSession({
      client,
      consumerId: loadOrCreateConsumerId({
        createId: () => `loom-console-${crypto.randomUUID()}`,
        ...(storage === undefined ? {} : { storage }),
        storageKey: "loom-console-consumer-id",
      }),
      roomId,
    });
    sessions.set(roomId, session);
  }
  return session;
}

export function errorText(error: unknown): string {
  if (error instanceof RahClientError) {
    return error.status === 401
      ? "会话已失效，请刷新页面"
      : `${error.message}（${error.code}，HTTP ${String(error.status)}）`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
