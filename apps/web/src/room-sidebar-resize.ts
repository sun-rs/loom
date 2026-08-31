export const RAFT_ROOM_SIDEBAR_DEFAULT_WIDTH = 240;
export const RAFT_ROOM_SIDEBAR_MIN_WIDTH = 180;
export const RAFT_ROOM_SIDEBAR_MAX_WIDTH = 400;

const RAFT_ROOM_SIDEBAR_KEYBOARD_STEP = 8;

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
