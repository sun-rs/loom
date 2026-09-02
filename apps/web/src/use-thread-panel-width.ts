import { useState } from "react";

import {
  RAFT_THREAD_PANEL_DEFAULT_WIDTH,
  readThreadPanelWidth,
  writeThreadPanelWidth,
} from "./thread-panel-resize.ts";

export function useThreadPanelWidth() {
  const [width, setWidth] = useState(() => {
    try {
      return readThreadPanelWidth(window.localStorage, window.innerWidth);
    } catch {
      return RAFT_THREAD_PANEL_DEFAULT_WIDTH;
    }
  });
  function commit(next: number) {
    try {
      writeThreadPanelWidth(window.localStorage, next, window.innerWidth);
    } catch {
      /* Optional layout preference. */
    }
  }
  return { width, setWidth, commit };
}
