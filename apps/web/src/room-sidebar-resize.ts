export const RAFT_ROOM_SIDEBAR_DEFAULT_WIDTH = 240;
export const RAFT_ROOM_SIDEBAR_MIN_WIDTH = 180;
export const RAFT_ROOM_SIDEBAR_MAX_WIDTH = 320;

const RAFT_ROOM_SIDEBAR_KEYBOARD_STEP = 8;

type LayoutStorage = Pick<Storage, "getItem" | "setItem">;
export function readRoomSidebarWidth(storage: LayoutStorage): number {
  try {
    const width = Number(storage.getItem("rah:room-sidebar-width"));
    if (
      Number.isFinite(width) &&
      width >= RAFT_ROOM_SIDEBAR_MIN_WIDTH &&
      width <= RAFT_ROOM_SIDEBAR_MAX_WIDTH
    )
      return width;
  } catch {
    /* Browser layout storage is optional. */
  }
  return RAFT_ROOM_SIDEBAR_DEFAULT_WIDTH;
}
export function writeRoomSidebarWidth(
  storage: LayoutStorage,
  width: number,
): void {
  try {
    storage.setItem(
      "rah:room-sidebar-width",
      String(clampRoomSidebarWidth(width)),
    );
  } catch {
    /* Keep dragging usable when storage is blocked. */
  }
}

export function clampRoomSidebarWidth(width: number): number {
  return Math.min(
    RAFT_ROOM_SIDEBAR_MAX_WIDTH,
    Math.max(RAFT_ROOM_SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

export function nextRoomSidebarWidth(
  width: number,
  key: string,
): number | undefined {
  switch (key) {
    case "ArrowLeft":
      return clampRoomSidebarWidth(width - RAFT_ROOM_SIDEBAR_KEYBOARD_STEP);
    case "ArrowRight":
      return clampRoomSidebarWidth(width + RAFT_ROOM_SIDEBAR_KEYBOARD_STEP);
    case "Home":
      return RAFT_ROOM_SIDEBAR_MIN_WIDTH;
    case "End":
      return RAFT_ROOM_SIDEBAR_MAX_WIDTH;
    default:
      return undefined;
  }
}
