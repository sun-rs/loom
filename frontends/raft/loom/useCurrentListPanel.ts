import { useLayoutEffect, useRef, useState } from "react";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel";
import { LIST_BOUNDS, resolveListWidth } from "./current-list-layout";
// Outer binding of official n2 measurement to Loom's existing sibling layout.
export function useCurrentListPanel(
  storageKey: string,
  half: boolean,
  rightMin = 0,
) {
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number>();
  const panel = useResizablePanel({
    storageKey,
    ...LIST_BOUNDS,
    getDragStartWidth: () => ref.current?.getBoundingClientRect().width,
  });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () =>
      setAvailable(
        Math.min(
          1360,
          Math.round(
            document.documentElement.clientWidth -
              node.getBoundingClientRect().left,
          ),
        ),
      );
    measure();
    const observer = new ResizeObserver(measure);
    for (
      let parent: Element | null = node;
      parent;
      parent = parent.parentElement
    )
      observer.observe(parent);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return {
    ...panel,
    ref,
    width:
      available === undefined
        ? panel.width
        : resolveListWidth(panel.width, available, half, rightMin),
  };
}
