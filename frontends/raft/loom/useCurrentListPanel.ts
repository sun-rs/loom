import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import { useLayoutEffect, useRef, useState } from "react";
import { useListColumnWidth, type ListColumn } from "./ListColumnResize";
import { LIST_BOUNDS, resolveListWidth } from "./current-list-layout";
// Outer binding of official n2 measurement to Loom's existing sibling layout.
export function useCurrentListPanel(
  column: ListColumn,
  half: boolean,
  rightMin = 0,
) {
  const touch = useMediaQuery("(pointer: coarse)");
  const detailMinimum = touch ? Math.max(360, rightMin) : rightMin;
  const ref = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number>();
  const preferred = useListColumnWidth(column);
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
    maxWidth:
      half && available !== undefined
        ? Math.max(
            LIST_BOUNDS.min,
            Math.min(Math.floor(available / 2), available - detailMinimum),
          )
        : undefined,
    ref,
    width:
      available === undefined
        ? preferred
        : resolveListWidth(preferred, available, half, detailMinimum),
  };
}
