import { layoutQueries } from "./adaptive-layout.ts";
import { useCallback, useEffect, useState, type RefObject } from "react";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives";
import { suppressNextSwipeClick } from "./OfficialActivitySwipe.generated";
// UI-only single-open-row binding of official ThreadsInbox Ut/Ht/outside handler.
export function useActivitySwipe(
  enabled: boolean,
  viewport: RefObject<HTMLElement | null>,
) {
  const narrow = useMediaQuery(layoutQueries.single);
  const coarse = useMediaQuery("(pointer: coarse)");
  const [selected, setSelected] = useState<string | null>(null);
  const openId = enabled && narrow && coarse ? selected : null;
  const onOpenChange = useCallback(
    (id: string, open: boolean) =>
      setSelected((previous) =>
        open ? id : previous === id ? null : previous,
      ),
    [],
  );
  useEffect(() => {
    if (openId === null) return;
    const outside = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest("[data-inbox-key]")?.getAttribute("data-inbox-key") ===
        openId
      )
        return;
      setSelected(null);
      if (target && viewport.current?.contains(target))
        suppressNextSwipeClick(event);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      setSelected((previous) => (previous === openId ? null : previous));
    };
  }, [openId, viewport]);
  return { enabled: enabled && narrow && coarse, openId, onOpenChange };
}
export type ActivitySwipeBinding = ReturnType<typeof useActivitySwipe>;
