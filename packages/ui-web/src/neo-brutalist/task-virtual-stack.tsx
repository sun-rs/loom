// Structural TypeScript port of Raft cce/uit; provenance: docs/design/task-virtual-window.md.
import {
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TaskVirtualRegistration } from "./task-virtual-layout.tsx";
const focusable =
  'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function TaskVirtualStack<T>({
  items,
  scrollElementRef,
  getItemKey,
  renderItem,
  estimateSize = 116,
  gap = 10,
}: {
  items: readonly T[];
  scrollElementRef: RefObject<HTMLDivElement | null>;
  getItemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  estimateSize?: number;
  gap?: number;
}) {
  const root = useRef<HTMLDivElement>(null),
    [margin, setMargin] = useState(0),
    register = useContext(TaskVirtualRegistration),
    id = useId();
  const current = useRef({ items, getItemKey, estimateSize, gap });
  current.current = { items, getItemKey, estimateSize, gap };
  useLayoutEffect(() => {
    const element = root.current,
      scroll = scrollElementRef.current;
    if (!element || !scroll) return;
    const layout = element.closest("[data-task-virtual-layout-root]");
    const measure = () => {
      const next =
        element.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top +
        scroll.scrollTop;
      setMargin((old) => (Math.abs(old - next) < 0.5 ? old : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroll);
    observer.observe(element);
    if (layout && layout !== element && layout !== scroll)
      observer.observe(layout);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [items.length, scrollElementRef]);
  const virtual = useVirtualizer({
    // Anchor corrections can run during layout; do not synchronously re-enter React.
    useFlushSync: false,
    count: items.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: () => estimateSize,
    getItemKey: (index) => getItemKey(items[index]!),
    gap,
    overscan: 6,
    scrollMargin: margin,
    initialRect: { width: 320, height: 720 },
  });
  const lookup = useCallback((key: string) => {
    const value = current.current,
      index = value.items.findIndex((item) => value.getItemKey(item) === key);
    return index < 0
      ? null
      : { index, estimatedStep: value.estimateSize + value.gap };
  }, []);
  useLayoutEffect(() => register?.(id, lookup), [register, id, lookup]);
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab" || event.defaultPrevented) return;
    const rows = virtual.getVirtualItems(),
      first = rows[0],
      last = rows.at(-1);
    if (!first || !last) return;
    const mounted = Array.from(
        root.current?.querySelectorAll<HTMLElement>(
          "[data-task-virtual-row-index]",
        ) ?? [],
      ),
      boundary = event.shiftKey ? mounted[0] : mounted.at(-1);
    const controls = Array.from(
      boundary?.querySelectorAll<HTMLElement>(focusable) ?? [],
    );
    if (event.target !== (event.shiftKey ? controls[0] : controls.at(-1)))
      return;
    const index = event.shiftKey ? first.index - 1 : last.index + 1;
    if (index < 0 || index >= items.length) return;
    event.preventDefault();
    virtual.scrollToIndex(index, { align: event.shiftKey ? "end" : "start" });
    const backwards = event.shiftKey;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const row = root.current?.querySelector(
            `[data-task-virtual-row-index="${index}"]`,
          ),
          controls = Array.from(
            row?.querySelectorAll<HTMLElement>(focusable) ?? [],
          );
        (backwards ? controls.at(-1) : controls[0])?.focus();
      }),
    );
  }
  return (
    <div
      ref={root}
      onKeyDownCapture={onKeyDown}
      data-testid="task-virtual-window"
      data-total-count={items.length}
      data-scroll-margin={margin}
      style={{
        height: virtual.getTotalSize(),
        position: "relative",
        width: "100%",
      }}
    >
      {virtual.getVirtualItems().map((row) => (
        <div
          key={row.key}
          ref={virtual.measureElement}
          data-index={row.index}
          data-task-virtual-row-index={row.index}
          data-task-virtual-key={String(row.key)}
          data-task-virtual-stack-id={id}
          data-testid="task-virtual-row"
          style={{
            left: 0,
            position: "absolute",
            top: 0,
            transform: `translateY(${row.start - margin}px)`,
            width: "100%",
          }}
        >
          {renderItem(items[row.index]!)}
        </div>
      ))}
    </div>
  );
}
