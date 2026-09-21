import { useEffect, useState } from "react";

import {
  RAFT_THREAD_PANEL_DEFAULT_WIDTH,
  readThreadPanelWidth,
  clampThreadPanelWidth,
  writeThreadPanelWidth,
} from "./thread-panel-resize.ts";

export function useThreadPanelWidth() {
  const [viewport, setViewport] = useState(window.innerWidth);
  const [preferred, setWidth] = useState<number>();
  useEffect(() => {
    const update = () => setViewport(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  // Re-read unedited preference after expansion. Narrow startup must not discard
  // a desktop preference merely because its current rendered limit is smaller.
  let stored = RAFT_THREAD_PANEL_DEFAULT_WIDTH;
  try {
    stored = readThreadPanelWidth(window.localStorage, viewport);
  } catch {
    /* Optional storage. */
  }
  const width = clampThreadPanelWidth(preferred ?? stored, viewport);
  function commit(next: number) {
    try {
      writeThreadPanelWidth(window.localStorage, next, window.innerWidth);
    } catch {
      /* Optional layout preference. */
    }
  }
  return { width, setWidth, commit };
}
