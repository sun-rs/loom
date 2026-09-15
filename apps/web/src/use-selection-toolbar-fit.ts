import { useLayoutEffect, useRef, useState } from "react";

/** Structural port of Raft xie: collapse trailing labels against measured width. */
export function useSelectionToolbarFit(actionCount: number, count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const lastWidth = useRef(0);
  const [collapsed, setCollapsed] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
      const used =
        Array.from(element.children).reduce(
          (sum, child) => sum + (child as HTMLElement).offsetWidth,
          0,
        ) +
        Math.max(0, element.children.length - 1) * gap;
      const grew = width > lastWidth.current + 8;
      lastWidth.current = width;
      setCollapsed((value) =>
        grew && value > 0
          ? 0
          : used > width + 1
            ? Math.min(actionCount, value + 1)
            : value,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [actionCount, count, collapsed]);
  return { ref, collapsed };
}
