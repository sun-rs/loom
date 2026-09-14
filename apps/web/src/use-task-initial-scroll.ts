import { useEffect, type RefObject } from "react";

/** Keep initial Task positioning through deferred content and composer layout.
 * User interaction hands ownership back to normal history browsing. */
export function useTaskInitialScroll(
  ref: RefObject<HTMLElement | null>,
  taskKey: string | undefined,
) {
  useEffect(() => {
    const element = ref.current;
    if (!element || !taskKey) return;
    let pinned = true;
    let frame = 0;
    const position = () => {
      cancelAnimationFrame(frame);
      if (pinned)
        frame = requestAnimationFrame(() => {
          element.scrollTop = element.scrollHeight;
        });
    };
    const release = () => {
      pinned = false;
      cancelAnimationFrame(frame);
    };
    const resize = new ResizeObserver(position);
    const observe = () => {
      resize.disconnect();
      resize.observe(element);
      for (const child of element.children) resize.observe(child);
      position();
    };
    const mutation = new MutationObserver(observe);
    mutation.observe(element, { childList: true, subtree: true });
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
      element.addEventListener(event, release, { passive: true });
    observe();
    return () => {
      release();
      resize.disconnect();
      mutation.disconnect();
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"])
        element.removeEventListener(event, release);
    };
  }, [ref, taskKey]);
}
