import { useEffect, useState, useRef, type RefObject } from "react";
/** Presentation-only port of v1.21.22 ThreadsInbox pendingFocusKind / focus scroll.
 * ChannelApp owns the one-shot request; no inbox state or read cursor is written.
 */
export function useFirstUnreadFocus(
  request: number,
  consume: () => void,
  rows: readonly { id: string; unread?: number }[],
  container: RefObject<HTMLDivElement | null>,
  ready: boolean,
  nextRequest = 0,
) {
  const handledNext = useRef(nextRequest);
  const [focus, setFocus] = useState<{ id: string; request: number }>();
  useEffect(() => {
    if (!request || !ready) return;
    const first = rows.find((row) => (row.unread ?? 0) > 0);
    if (!first) return; // Like upstream, retain intent until an unread row arrives.
    setFocus({ id: first.id, request });
    consume();
  }, [request, consume, rows, ready]);
  // Official ThreadsInbox Xe/Ze: title double-click cycles the currently loaded
  // unread rows. Unlike sidebar intent, an empty list does not queue future focus.
  useEffect(() => {
    if (handledNext.current === nextRequest) return;
    handledNext.current = nextRequest;
    if (!ready) return;
    const unread = rows.filter((row) => (row.unread ?? 0) > 0);
    if (!unread.length) return;
    const index = unread.findIndex((row) => row.id === focus?.id);
    setFocus({
      id: unread[(index + 1) % unread.length]!.id,
      request: nextRequest,
    });
  }, [nextRequest, ready, rows, focus]);
  useEffect(() => {
    if (!focus) return;
    const frame = requestAnimationFrame(() => {
      const root = container.current;
      const row = root?.querySelector<HTMLElement>(
        `[data-result-id="${CSS.escape(focus.id)}"]`,
      );
      if (!root || !row) return;
      root.scrollTo({
        top:
          root.scrollTop +
          row.getBoundingClientRect().top -
          root.getBoundingClientRect().top -
          8,
        behavior: "smooth",
      });
    });
    const timer = setTimeout(() => setFocus(undefined), 3000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [focus, container]);
  return focus?.id;
}
