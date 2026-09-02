export const RAFT_THREAD_PANEL_DEFAULT_WIDTH = 400;
export const RAFT_THREAD_PANEL_MIN_WIDTH = 360;

const RAFT_THREAD_PANEL_STORAGE_KEY = "rah:thread-panel-width";
const RAFT_THREAD_PANEL_KEYBOARD_STEP = 8;
type LayoutStorage = Pick<Storage, "getItem" | "setItem">;

// Direct port of Raft o7: the drag maximum tracks 60% of the viewport and
// never falls below the default width. CSS separately protects 320px of chat.
export function threadPanelMaxWidth(viewportWidth: number): number {
  return Math.max(
    RAFT_THREAD_PANEL_DEFAULT_WIDTH,
    Math.floor(viewportWidth * 0.6),
  );
}

export function clampThreadPanelWidth(
  width: number,
  viewportWidth: number,
): number {
  return Math.min(
    threadPanelMaxWidth(viewportWidth),
    Math.max(RAFT_THREAD_PANEL_MIN_WIDTH, Math.round(width)),
  );
}

export function readThreadPanelWidth(
  storage: LayoutStorage,
  viewportWidth: number,
): number {
  try {
    const width = Number(storage.getItem(RAFT_THREAD_PANEL_STORAGE_KEY));
    if (
      Number.isFinite(width) &&
      width >= RAFT_THREAD_PANEL_MIN_WIDTH &&
      width <= threadPanelMaxWidth(viewportWidth)
    )
      return width;
  } catch {
    /* Browser layout storage is optional. */
  }
  return RAFT_THREAD_PANEL_DEFAULT_WIDTH;
}

export function writeThreadPanelWidth(
  storage: LayoutStorage,
  width: number,
  viewportWidth: number,
): void {
  try {
    storage.setItem(
      RAFT_THREAD_PANEL_STORAGE_KEY,
      String(clampThreadPanelWidth(width, viewportWidth)),
    );
  } catch {
    /* Keep pointer resizing available when storage is blocked. */
  }
}

export function nextThreadPanelWidth(
  width: number,
  key: string,
  viewportWidth: number,
): number | undefined {
  switch (key) {
    case "ArrowLeft":
      return clampThreadPanelWidth(
        width + RAFT_THREAD_PANEL_KEYBOARD_STEP,
        viewportWidth,
      );
    case "ArrowRight":
      return clampThreadPanelWidth(
        width - RAFT_THREAD_PANEL_KEYBOARD_STEP,
        viewportWidth,
      );
    case "Home":
      return RAFT_THREAD_PANEL_MIN_WIDTH;
    case "End":
      return threadPanelMaxWidth(viewportWidth);
    default:
      return undefined;
  }
}
