import { useEffect, useRef, useState, type RefObject } from "react";
import { nativePullOffset } from "./mobile-activity";
// Browser touch adapter for native Cupertino trigger100/hold60/rubber-band0.55.
// Owns transient presentation only; existing feed owner performs the refresh.
export function useMobilePullRefresh(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  loading: boolean,
  onRefresh: () => void,
  completed = 0,
) {
  const [distance, setDistance] = useState(0),
    [pending, setPending] = useState(false);
  const latest = useRef({ loading, onRefresh, completed });
  latest.current = { loading, onRefresh, completed };
  const startedAt = useRef(completed);
  const busy = useRef(false),
    sawLoading = useRef(false);
  useEffect(() => {
    if (!busy.current) return;
    if (loading) sawLoading.current = true;
    else if (sawLoading.current || completed !== startedAt.current) {
      busy.current = false;
      sawLoading.current = false;
      setPending(false);
      setDistance(0);
    }
  }, [loading, completed]);
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let start: { x: number; y: number; id: number; claimed: boolean } | null =
        null,
      offset = 0;
    const reset = () => {
      start = null;
      offset = 0;
      if (!busy.current) setDistance(0);
    };
    const down = (e: TouchEvent) => {
      if (
        e.touches.length !== 1 ||
        el.scrollTop > 0 ||
        latest.current.loading ||
        busy.current
      )
        return;
      const t = e.touches[0],
        r = el.getBoundingClientRect();
      if (t.clientX - r.left < 24 || r.right - t.clientX < 24) return;
      start = { x: t.clientX, y: t.clientY, id: t.identifier, claimed: false };
    };
    const move = (e: TouchEvent) => {
      if (!start) return;
      if (e.touches.length !== 1) {
        reset();
        return;
      }
      const t = e.touches[0];
      if (t.identifier !== start.id) {
        reset();
        return;
      }
      const dx = t.clientX - start.x,
        dy = t.clientY - start.y;
      if (!start.claimed) {
        if (
          (Math.abs(dx) > 10 && Math.abs(dx) >= Math.abs(dy) / 2) ||
          dy < 0 ||
          el.scrollTop > 0
        ) {
          reset();
          return;
        }
        if (dy < 10) return;
        start.claimed = true;
      }
      if (e.cancelable) e.preventDefault();
      offset = nativePullOffset(Math.max(0, dy), el.clientHeight);
      setDistance(offset);
    };
    const up = () => {
      const commit = start?.claimed && offset >= 100;
      reset();
      if (!commit || busy.current || latest.current.loading) return;
      startedAt.current = latest.current.completed;
      busy.current = true;
      sawLoading.current = false;
      setPending(true);
      setDistance(60);
      try {
        latest.current.onRefresh();
      } catch {
        busy.current = false;
        setPending(false);
        setDistance(0);
      }
    };
    el.addEventListener("touchstart", down, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", reset);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", reset);
    };
  }, [ref, enabled]);
  return { distance, pending };
}
