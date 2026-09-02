import { useState } from "react";
import {
  readRoomSidebarWidth,
  writeRoomSidebarWidth,
  RAFT_ROOM_SIDEBAR_DEFAULT_WIDTH,
} from "./room-sidebar-resize.ts";

/** Raft $_ structural port: persist on drag end, not every pointer movement.
 * This is a browser layout preference, never a Room/Agent projection cache. */
export function useRoomSidebarWidth() {
  const [width, setWidth] = useState(() => {
    try {
      return readRoomSidebarWidth(window.localStorage);
    } catch {
      return RAFT_ROOM_SIDEBAR_DEFAULT_WIDTH;
    }
  });
  function commit(next: number) {
    try {
      writeRoomSidebarWidth(window.localStorage, next);
    } catch {
      /* Optional layout storage. */
    }
  }
  return { width, setWidth, commit };
}
