import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

// Raft oS/qt resets natural height then clamps it. Read the effective CSS cap
// (max-h-32 wins over upstream's JS 160px), including responsive minimums.
function resizeComposer(element: HTMLTextAreaElement | null) {
  if (!element || element.clientWidth === 0) return;
  const style = getComputedStyle(element);
  const minimum = Number.parseFloat(style.minHeight) || 0;
  const maximum = Number.parseFloat(style.maxHeight) || 160;
  const scrollTop = element.scrollTop;
  element.style.height = "auto";
  const natural = element.value ? element.scrollHeight : minimum;
  element.style.height = `${Math.max(minimum, Math.min(natural, maximum))}px`;
  element.style.overflowY = natural > maximum ? "auto" : "hidden";
  if (natural > maximum) element.scrollTop = scrollTop;
}

/** One size owner for Room, DM, Thread and attachment comment composers. */
export function useComposerAutosize(
  ref: RefObject<HTMLTextAreaElement | null>,
  value: string,
) {
  const observer = useRef<ResizeObserver | null>(null);
  const attach = useCallback(
    (element: HTMLTextAreaElement | null) => {
      observer.current?.disconnect();
      ref.current = element;
      if (!element) return;
      resizeComposer(element);
      let previousWidth = element.clientWidth;
      observer.current = new ResizeObserver(() => {
        const width = element.clientWidth;
        if (width === previousWidth) return;
        previousWidth = width;
        resizeComposer(element);
      });
      observer.current.observe(element);
      void document.fonts.ready.then(() => {
        if (ref.current === element) resizeComposer(element);
      });
    },
    [ref],
  );
  useLayoutEffect(() => resizeComposer(ref.current), [ref, value]);
  return attach;
}
