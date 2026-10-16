import { useEffect, useMemo, useState, useRef, type RefObject } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Message } from "@rah-os/protocol";
import {
  ThreadActivityClient,
  visibleThreadFrontier,
} from "./thread-activity.ts";

/** Read only geometrically visible replies, never the timeline's translation overscan window. */
export function useThreadActivity(
  client: RahClient,
  roomId: string,
  threadId: string | undefined,
  messages: Message[],
  host: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const bridge = useMemo(
    () =>
      threadId ? new ThreadActivityClient(client, roomId, threadId) : undefined,
    [client, roomId, threadId],
  );
  const active = useRef(bridge);
  active.current = bridge;
  useEffect(() => {
    active.current = bridge;
    return () => {
      if (active.current === bridge) active.current = undefined;
    };
  }, [bridge]);
  const [following, setFollowing] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setFollowing(undefined);
    setBusy(false);
    setError("");
    if (bridge && enabled)
      void bridge
        .refresh(abort.signal)
        .then(() => {
          if (!abort.signal.aborted) setFollowing(bridge.following);
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setError("关注状态暂时无法读取，请重新读取。");
        });
    return () => abort.abort();
  }, [bridge, enabled, retry]);
  useEffect(() => {
    const element = host.current;
    if (!bridge || !threadId || !element || !enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      if (disposed || document.hidden) return;
      const scroller = element.querySelector(
        '[data-testid="thread-message-scroller"]',
      );
      if (!scroller) return;
      const bounds = scroller.getBoundingClientRect();
      const top = Math.max(bounds.top, 0),
        bottom = Math.min(bounds.bottom, innerHeight);
      const ids = Array.from(
        scroller.querySelectorAll<HTMLElement>("[data-timeline-message-id]"),
      )
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return (
            bottom > top &&
            rect.height > 0 &&
            rect.bottom > top &&
            rect.top < bottom &&
            rect.right > 0 &&
            rect.left < innerWidth
          );
        })
        .map((node) => node.dataset.timelineMessageId!);
      const seq = visibleThreadFrontier(messages, ids, roomId, threadId);
      void bridge.markVisible(seq).catch(() => {
        if (!disposed) setError("消息列已读状态未确认；未自动重发。");
      });
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(check, 150);
    };
    element.addEventListener("scroll", schedule, true);
    document.addEventListener("visibilitychange", schedule);
    const observer = new MutationObserver(schedule);
    observer.observe(element, { childList: true, subtree: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    schedule();
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      resize.disconnect();
      element.removeEventListener("scroll", schedule, true);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [bridge, threadId, roomId, messages, host, enabled]);
  return {
    following,
    busy,
    error,
    reload: () => setRetry((v) => v + 1),
    follow: async () => {
      if (!bridge || busy || following === undefined || !enabled) return;
      setBusy(true);
      setError("");
      const desired = !following;
      try {
        await bridge.follow(desired);
        if (active.current !== bridge) return;
        setFollowing(bridge.following);
        if (bridge.following !== desired)
          setError("关注操作未生效，已重新读取当前状态。");
      } catch {
        if (active.current !== bridge) return;
        setFollowing(undefined);
        setError("关注结果暂时无法核实；请重新读取，不会自动重发。");
      } finally {
        if (active.current === bridge) setBusy(false);
      }
    },
  };
}
