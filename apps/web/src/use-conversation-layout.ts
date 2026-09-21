import { useLayoutEffect, useRef, useState } from "react";
import { conversationLayout } from "./conversation-layout.ts";
/** Display measurement only. Keep both mounted panes, draft and scroll owners. */
export function useConversationLayout(
  sidebarWidth: number,
  panelKind: "thread" | "profile" = "thread",
): {
  ref: (element: HTMLDivElement | null) => void;
  mode: ReturnType<typeof conversationLayout>;
} {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [mode, setMode] =
    useState<ReturnType<typeof conversationLayout>>("replace");
  const measure = useRef<(() => void) | null>(null);
  const panel = useRef(panelKind);
  const sidebar = useRef(sidebarWidth);
  useLayoutEffect(() => {
    sidebar.current = sidebarWidth;
    panel.current = panelKind;
    measure.current?.();
  }, [sidebarWidth, panelKind]);
  useLayoutEffect(() => {
    if (!element) return;
    const update = () => {
      const style = getComputedStyle(element);
      const rail = parseFloat(style.getPropertyValue("--rail-w")) || 64;
      setMode(
        conversationLayout(
          element.clientWidth,
          window.innerHeight,
          rail + sidebar.current,
          panel.current,
        ),
      );
    };
    measure.current = update;
    update();
    // The observer owns container resizing; a window listener would measure
    // the same change twice. Sidebar preferences update through the ref above.
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      measure.current = null;
      observer.disconnect();
    };
  }, [element]);
  return { ref, mode };
}
