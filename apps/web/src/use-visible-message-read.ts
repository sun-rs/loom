import { useEffect, useRef, type RefObject } from "react";
import { visibleReadFrontier } from "./global-discovery-model.ts";

/** UI visibility evidence only. Kernel owns the monotonic Human acknowledgement. */
export function useVisibleMessageRead(
  element: RefObject<HTMLElement | null>,
  scope: string | undefined,
  messages: readonly { messageId: string; roomSeq: number }[],
  acknowledge: ((throughSeq: number) => Promise<void | number>) | undefined,
) {
  const seen = useRef({ scope, throughSeq: 0 });
  useEffect(() => {
    const node = element.current;
    if (!node || !scope || !acknowledge) return;
    if (seen.current.scope !== scope) seen.current = { scope, throughSeq: 0 };
    const state = seen.current;
    const sequences = new Map(
      messages.map((message) => [message.messageId, message.roomSeq]),
    );
    let timer: ReturnType<typeof setTimeout>;
    const inspect = () => {
      if (document.visibilityState !== "visible" || node.clientHeight === 0)
        return;
      const viewport = node.getBoundingClientRect();
      const rows = [
        ...node.querySelectorAll<HTMLElement>(
          "[data-message-id], [data-read-event-id]",
        ),
      ].map((row) => {
        const rect = row.getBoundingClientRect();
        return {
          seq:
            sequences.get(
              row.dataset.messageId ?? row.dataset.readEventId ?? "",
            ) ?? 0,
          top: rect.top,
          bottom: rect.bottom,
        };
      });
      const throughSeq = visibleReadFrontier(rows, viewport);
      if (throughSeq <= state.throughSeq) return;
      const previous = state.throughSeq;
      state.throughSeq = throughSeq;
      void acknowledge(throughSeq)
        .then((accepted) => {
          if (typeof accepted === "number" && state.throughSeq === throughSeq)
            state.throughSeq = accepted;
        })
        .catch(() => {
          // Failed acknowledgement may retry on the next visibility/scroll/render event.
          if (state.throughSeq === throughSeq) state.throughSeq = previous;
        });
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(inspect, 150);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(node, { childList: true, subtree: true });
    node.addEventListener("scroll", schedule, { passive: true });
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("focus", schedule);
    schedule();
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      node.removeEventListener("scroll", schedule);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("focus", schedule);
    };
  }, [acknowledge, element, messages, scope]);
}
