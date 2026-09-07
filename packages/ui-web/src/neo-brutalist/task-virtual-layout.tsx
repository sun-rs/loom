// Structural TypeScript port of Raft L8/Fj/lce; provenance: docs/design/task-virtual-window.md.
import {
  createContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type HTMLAttributes,
  type RefObject,
} from "react";
type Lookup = (key: string) => { index: number; estimatedStep: number } | null;
type Anchor = { key: string; stackId: string; top: number; index: number };
export const TaskVirtualRegistration = createContext<
  ((id: string, lookup: Lookup) => () => void) | null
>(null);
function visible(
  root: HTMLElement | null,
  scroll: HTMLElement | null,
  registrations: Map<string, Lookup>,
): Anchor[] {
  if (!root || !scroll) return [];
  const viewport = scroll.getBoundingClientRect();
  return Array.from(
    root.querySelectorAll<HTMLElement>("[data-task-virtual-key]"),
  )
    .map((row) => ({
      key: row.dataset.taskVirtualKey ?? "",
      stackId: row.dataset.taskVirtualStackId ?? "",
      index: Number(row.dataset.index),
      rect: row.getBoundingClientRect(),
    }))
    .filter(
      (row) =>
        row.key &&
        registrations.has(row.stackId) &&
        Number.isFinite(row.index) &&
        row.rect.bottom > viewport.top &&
        row.rect.top < viewport.bottom &&
        row.rect.right > viewport.left &&
        row.rect.left < viewport.right,
    )
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
    .map(({ key, stackId, index, rect }) => ({
      key,
      stackId,
      index,
      top: rect.top,
    }));
}
export function TaskVirtualLayout({
  scrollElementRef,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  scrollElementRef: RefObject<HTMLDivElement | null>;
}) {
  const root = useRef<HTMLDivElement>(null),
    anchors = useRef<Anchor[]>([]),
    registrations = useRef(new Map<string, Lookup>());
  const adjusting = useRef(false),
    corrections = useRef(0),
    frame = useRef(0),
    latest = useRef<() => void>(() => {});
  const register = useCallback((id: string, lookup: Lookup) => {
    registrations.current.set(id, lookup);
    return () => {
      if (registrations.current.get(id) === lookup)
        registrations.current.delete(id);
    };
  }, []);
  const correct = useCallback(() => {
    const element = root.current,
      scroll = scrollElementRef.current;
    if (!element || !scroll) return;
    let changed = false;
    const mounted = new Map(
      Array.from(
        element.querySelectorAll<HTMLElement>("[data-task-virtual-key]"),
      ).map((row) => [row.dataset.taskVirtualKey ?? "", row]),
    );
    for (const anchor of anchors.current) {
      const row = mounted.get(anchor.key),
        same = row?.dataset.taskVirtualStackId === anchor.stackId;
      const location =
        registrations.current.get(anchor.stackId)?.(anchor.key) ?? null;
      let delta = same ? row!.getBoundingClientRect().top - anchor.top : null;
      if (same && location) anchor.index = location.index;
      if (!same && !location) {
        anchors.current = anchors.current.filter((item) => item !== anchor);
        continue;
      }
      if (delta === null && location) {
        delta = (location.index - anchor.index) * location.estimatedStep;
        anchor.index = location.index;
      }
      if (delta !== null) {
        if (Math.abs(delta) >= 0.5) {
          scroll.scrollTop += delta;
          changed = true;
        }
        break;
      }
    }
    if (changed && corrections.current < 5) {
      adjusting.current = true;
      corrections.current++;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => latest.current());
      return;
    }
    const next = visible(element, scroll, registrations.current);
    if (next.length) anchors.current = next;
    if (adjusting.current) {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        adjusting.current = false;
        corrections.current = 0;
        const next = visible(
          root.current,
          scrollElementRef.current,
          registrations.current,
        );
        if (next.length) anchors.current = next;
      });
      return;
    }
    corrections.current = 0;
  }, [scrollElementRef]);
  latest.current = correct;
  useLayoutEffect(correct);
  useEffect(() => {
    const element = root.current,
      scroll = scrollElementRef.current;
    if (!element || !scroll) return;
    let capture = 0;
    const onScroll = () => {
      if (!adjusting.current) {
        anchors.current = [];
        cancelAnimationFrame(capture);
        capture = requestAnimationFrame(() => {
          anchors.current = visible(element, scroll, registrations.current);
        });
      }
    };
    const onInput = () => {
      adjusting.current = false;
      corrections.current = 0;
      anchors.current = [];
      cancelAnimationFrame(frame.current);
    };
    const observer = new ResizeObserver(correct);
    observer.observe(element);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    for (const event of ["wheel", "touchstart", "pointerdown"])
      scroll.addEventListener(event, onInput, { passive: true });
    return () => {
      cancelAnimationFrame(capture);
      cancelAnimationFrame(frame.current);
      observer.disconnect();
      scroll.removeEventListener("scroll", onScroll);
      for (const event of ["wheel", "touchstart", "pointerdown"])
        scroll.removeEventListener(event, onInput);
    };
  }, [correct, scrollElementRef]);
  return (
    <TaskVirtualRegistration.Provider value={register}>
      <div ref={root} data-task-virtual-layout-root {...props}>
        {children}
      </div>
    </TaskVirtualRegistration.Provider>
  );
}
