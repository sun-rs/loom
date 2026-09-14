export const RAFT_COMPUTER_SIDEBAR_DEFAULT_WIDTH = 240;
export const RAFT_COMPUTER_SIDEBAR_MIN_WIDTH = 180;
export const RAFT_COMPUTER_SIDEBAR_MAX_WIDTH = 320;

const RAFT_COMPUTER_SIDEBAR_KEYBOARD_STEP = 8;
const COMPUTER_SIDEBAR_STORAGE_KEY = "rah:computer-sidebar-width";

type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export function readComputerSidebarWidth(storage: LayoutStorage): number {
  try {
    const width = Number(storage.getItem(COMPUTER_SIDEBAR_STORAGE_KEY));
    if (
      Number.isFinite(width) &&
      width >= RAFT_COMPUTER_SIDEBAR_MIN_WIDTH &&
      width <= RAFT_COMPUTER_SIDEBAR_MAX_WIDTH
    )
      return width;
  } catch {
    /* Layout persistence is optional. */
  }
  return RAFT_COMPUTER_SIDEBAR_DEFAULT_WIDTH;
}

export function writeComputerSidebarWidth(
  storage: LayoutStorage,
  width: number,
): void {
  try {
    storage.setItem(
      COMPUTER_SIDEBAR_STORAGE_KEY,
      String(clampComputerSidebarWidth(width)),
    );
  } catch {
    /* Keep the pointer interaction usable when storage is blocked. */
  }
}

export function clampComputerSidebarWidth(width: number): number {
  return Math.min(
    RAFT_COMPUTER_SIDEBAR_MAX_WIDTH,
    Math.max(RAFT_COMPUTER_SIDEBAR_MIN_WIDTH, Math.round(width)),
  );
}

export function nextComputerSidebarWidth(
  width: number,
  key: string,
): number | undefined {
  switch (key) {
    case "ArrowLeft":
      return clampComputerSidebarWidth(
        width - RAFT_COMPUTER_SIDEBAR_KEYBOARD_STEP,
      );
    case "ArrowRight":
      return clampComputerSidebarWidth(
        width + RAFT_COMPUTER_SIDEBAR_KEYBOARD_STEP,
      );
    case "Home":
      return RAFT_COMPUTER_SIDEBAR_MIN_WIDTH;
    case "End":
      return RAFT_COMPUTER_SIDEBAR_MAX_WIDTH;
    default:
      return undefined;
  }
}
