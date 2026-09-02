export const RAFT_PROFILE_PANEL_DEFAULT_WIDTH = 380;
export const RAFT_PROFILE_PANEL_MIN_WIDTH = 300;
export const RAFT_PROFILE_PANEL_MAX_WIDTH = 600;

const RAFT_PROFILE_PANEL_STORAGE_KEY = "rah:profile-panel-width";
const RAFT_PROFILE_PANEL_KEYBOARD_STEP = 8;

type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

export function clampProfilePanelWidth(width: number): number {
  return Math.min(
    RAFT_PROFILE_PANEL_MAX_WIDTH,
    Math.max(RAFT_PROFILE_PANEL_MIN_WIDTH, Math.round(width)),
  );
}

export function readProfilePanelWidth(storage: LayoutStorage): number {
  try {
    const width = Number(storage.getItem(RAFT_PROFILE_PANEL_STORAGE_KEY));
    if (
      Number.isFinite(width) &&
      width >= RAFT_PROFILE_PANEL_MIN_WIDTH &&
      width <= RAFT_PROFILE_PANEL_MAX_WIDTH
    )
      return width;
  } catch {
    /* Browser layout storage is optional. */
  }
  return RAFT_PROFILE_PANEL_DEFAULT_WIDTH;
}

export function writeProfilePanelWidth(
  storage: LayoutStorage,
  width: number,
): void {
  try {
    storage.setItem(
      RAFT_PROFILE_PANEL_STORAGE_KEY,
      String(clampProfilePanelWidth(width)),
    );
  } catch {
    /* Keep dragging usable when storage is blocked. */
  }
}

export function nextProfilePanelWidth(
  width: number,
  key: string,
): number | undefined {
  switch (key) {
    case "ArrowLeft":
      return clampProfilePanelWidth(width + RAFT_PROFILE_PANEL_KEYBOARD_STEP);
    case "ArrowRight":
      return clampProfilePanelWidth(width - RAFT_PROFILE_PANEL_KEYBOARD_STEP);
    case "Home":
      return RAFT_PROFILE_PANEL_MIN_WIDTH;
    case "End":
      return RAFT_PROFILE_PANEL_MAX_WIDTH;
    default:
      return undefined;
  }
}
