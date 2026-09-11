import { useLayoutEffect, useState } from "react";
import { conversationLayout } from "./conversation-layout.ts";
/** Display measurement only. Keep both mounted panes, draft and scroll owners. */
export function useConversationLayout(sidebarWidth: number) {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const [mode, setMode] =
    useState<ReturnType<typeof conversationLayout>>("replace");
  useLayoutEffect(() => {
    if (!element) return;
    const update = () => {
      const style = getComputedStyle(element);
      const rail = parseFloat(style.getPropertyValue("--rail-w")) || 64;
      setMode(
        conversationLayout(
          element.clientWidth,
          window.innerHeight,
          rail + sidebarWidth,
        ),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [element, sidebarWidth]);
  return { ref, mode };
}
