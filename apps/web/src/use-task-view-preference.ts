import { useState } from "react";
import type { TaskViewMode } from "./components/task-toolbar.tsx";
import { useResponsiveTaskView } from "./use-responsive-task-view.ts";

/** Global Tasks presentation only; independent of transient task filters. */
export function useTaskViewPreference(
  workspaceId: string,
  principalId: string | undefined,
  routeView: string | null,
) {
  const key = JSON.stringify(["rah.task-view.v1", workspaceId, principalId]);
  const [selection, setSelection] = useState<{
    key: string;
    view: TaskViewMode;
  }>();
  let saved: string | null = null;
  try {
    saved = window.localStorage.getItem(key);
  } catch {
    // Storage may be disabled; the current mounted view still works.
  }
  const remembered = selection?.key === key ? selection.view : saved;
  const explicit =
    routeView === "board" || routeView === "list" ? routeView : remembered;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const responsive = useResponsiveTaskView(
    explicit === "board" || explicit === "list" ? explicit : undefined,
    standalone,
  );
  return {
    ...responsive,
    remember(view: TaskViewMode) {
      setSelection({ key, view });
      try {
        window.localStorage.setItem(key, view);
      } catch {
        /* Best effort. */
      }
    },
  };
}
