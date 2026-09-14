import { useEffect } from "react";

/** Base UI deliberately skips scroll locking for touch-open menus. Keep the
 * initiating gesture and later background swipes from moving the viewport,
 * while an overflowing menu may still scroll its own options. */
export function useTouchMenuLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const preventBackgroundPan = (event: TouchEvent) => {
      const menu =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(".rah-context-actions")
          : null;
      if (!menu || menu.scrollHeight <= menu.clientHeight)
        event.preventDefault();
    };
    document.addEventListener("touchmove", preventBackgroundPan, {
      capture: true,
      passive: false,
    });
    return () =>
      document.removeEventListener("touchmove", preventBackgroundPan, true);
  }, [open]);
}
