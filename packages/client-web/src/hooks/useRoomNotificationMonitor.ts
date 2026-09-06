import { useEffect } from "react";

import { listRooms, readRoomInbox } from "../room-api";
import { notifyForRoomInboxItems } from "../browser-notifications";

const POLL_MS = 3_000;
const PAGE_LIMIT = 200;
const ROOM_CATALOG_REFRESH_MS = 30_000;
const MAX_CATALOG_PAGES = 20;
const INBOX_CURSOR_KEY = "rah-room-inbox-cursor-v1";

function readStoredCursor(): string | undefined {
  try { return window.localStorage.getItem(INBOX_CURSOR_KEY) || undefined; } catch { return undefined; }
}

function storeCursor(cursor: string): void {
  try { window.localStorage.setItem(INBOX_CURSOR_KEY, cursor); } catch { /* retry in memory */ }
}

function clearStoredCursor(): void {
  try { window.localStorage.removeItem(INBOX_CURSOR_KEY); } catch { /* ignore */ }
}

/**
 * Global Human Inbox monitor. The initial durable backlog establishes a
 * cursor without producing stale notifications; only later Inbox entries are
 * surfaced. Room content remains daemon-owned and is never inferred here.
 */
export function useRoomNotificationMonitor(): void {
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let cursor: string | undefined = readStoredCursor();
    let roomNames = new Map<string, string>();
    let catalogRefreshAt = 0;

    const refreshRoomNames = async (force = false) => {
      if (!force && roomNames.size > 0 && Date.now() < catalogRefreshAt) return;
      const nextNames = new Map<string, string>();
      let catalogCursor: string | undefined;
      let pages = 0;
      do {
        const catalog = await listRooms({
          ...(catalogCursor ? { cursor: catalogCursor } : {}),
          limit: PAGE_LIMIT,
        });
        for (const item of catalog.items) nextNames.set(item.room.roomId, item.room.name);
        catalogCursor = catalog.roomListCursor;
        pages += 1;
      } while (catalogCursor && pages < MAX_CATALOG_PAGES && !disposed);
      roomNames = nextNames;
      catalogRefreshAt = Date.now() + ROOM_CATALOG_REFRESH_MS;
    };

    const poll = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        await refreshRoomNames();
        if (!cursor) {
          const baseline = await readRoomInbox({ start: "latest" });
          cursor = baseline.inboxCursor;
          storeCursor(cursor);
        }
        let pages = 0;
        do {
          const response = await readRoomInbox({ ...(cursor ? { cursor } : {}), limit: PAGE_LIMIT });
          if (response.items.length > 0) {
            if (response.items.some((item) => !roomNames.has(item.roomId))) {
              await refreshRoomNames(true);
            }
            const delivered = await notifyForRoomInboxItems({ items: response.items, roomNames });
            if (!delivered) break;
          }
          cursor = response.inboxCursor;
          storeCursor(cursor);
          pages += 1;
          if (response.items.length < PAGE_LIMIT) {
            break;
          }
        } while (!disposed && pages < 20);
      } catch (error) {
        if (cursor && error instanceof Error && /cursor|generation|invalid/i.test(error.message)) {
          cursor = undefined;
          clearStoredCursor();
        }
        // Existing global connection UI owns transport errors. The durable
        // cursor makes a later retry lossless.
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);
}
