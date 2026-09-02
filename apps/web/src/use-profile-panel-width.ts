import { useState } from "react";

import {
  readProfilePanelWidth,
  writeProfilePanelWidth,
  RAFT_PROFILE_PANEL_DEFAULT_WIDTH,
} from "./profile-panel-resize.ts";

/** Raft profile-panel port: persist only when a drag/keyboard step completes. */
export function useProfilePanelWidth() {
  const [width, setWidth] = useState(() => {
    try {
      return readProfilePanelWidth(window.localStorage);
    } catch {
      return RAFT_PROFILE_PANEL_DEFAULT_WIDTH;
    }
  });
  function commit(next: number) {
    try {
      writeProfilePanelWidth(window.localStorage, next);
    } catch {
      /* Optional layout storage. */
    }
  }
  return { width, setWidth, commit };
}
