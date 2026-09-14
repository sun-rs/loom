import { useEffect, useRef, useState } from "react";

/** Raft Sy: 240ms enter / 180ms exit. Only overlay drawers use this lifetime. */
export function useOverlayDrawerMotion(onClosed: () => void) {
  const [closing, setClosing] = useState(false);
  const callback = useRef(onClosed);
  callback.current = onClosed;
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(
      () => callback.current(),
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180,
    );
    return () => window.clearTimeout(timer);
  }, [closing]);
  return { closing, close: () => setClosing(true) };
}
