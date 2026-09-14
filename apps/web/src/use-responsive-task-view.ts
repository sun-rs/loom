import { useLayoutEffect, useState } from "react";
import type { TaskViewMode } from "./components/task-toolbar.tsx";

/** Presentation-only default. Explicit selections always take precedence. */
export function useResponsiveTaskView(explicitView?: TaskViewMode) {
  const [element, ref] = useState<HTMLElement | null>(null);
  const [defaultView, setDefaultView] = useState<TaskViewMode>("list");
  useLayoutEffect(() => {
    if (!element) return;
    const update = () =>
      setDefaultView(element.clientWidth < 768 ? "list" : "board");
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return { ref, view: explicitView ?? defaultView };
}
