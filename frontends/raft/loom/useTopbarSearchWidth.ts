// Structural port: v1.21.26 app-shell Bc6GbYfj bAt/xAt/SAt/CAt/wAt.
import { useLayoutEffect, useState, type RefObject } from "react";
export function topbarBaseWidth(viewport: number) {
  return Math.min(520, Math.max(360, viewport * 0.32));
}
export function topbarSearchWidth(
  base: number,
  current: number,
  leading: number,
  trailing: number,
) {
  const free = Math.max(0, Math.min(leading, trailing) + (current - base) / 2);
  return Math.min(Math.max(base, 520), base + 2 * Math.floor(free));
}
function freeWidth(element: HTMLElement) {
  const rect = element.getBoundingClientRect(),
    style = getComputedStyle(element);
  const widths = [...element.children]
    .map((e) => e.getBoundingClientRect().width)
    .filter((w) => w > 0);
  return (
    rect.width -
    (parseFloat(style.paddingLeft) || 0) -
    (parseFloat(style.paddingRight) || 0) -
    widths.reduce((a, b) => a + b, 0) -
    (parseFloat(style.columnGap) || 0) * Math.max(0, widths.length - 1)
  );
}
export function useTopbarSearchWidth(
  search: RefObject<HTMLElement | null>,
  leading: RefObject<HTMLElement | null>,
  trailing: RefObject<HTMLElement | null>,
) {
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const s = search.current,
      l = leading.current,
      r = trailing.current;
    if (!s || !l || !r) return;
    const update = () =>
      setWidth(
        topbarSearchWidth(
          topbarBaseWidth(innerWidth),
          s.getBoundingClientRect().width,
          freeWidth(l),
          freeWidth(r),
        ),
      );
    const observer = new ResizeObserver(update);
    const observe = () => {
      observer.disconnect();
      for (const el of [l, r, ...l.children, ...r.children])
        observer.observe(el);
    };
    observe();
    update();
    const mutations = new MutationObserver(() => {
      observe();
      update();
    });
    mutations.observe(l, { childList: true });
    mutations.observe(r, { childList: true });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [search, leading, trailing]);
  return width;
}
