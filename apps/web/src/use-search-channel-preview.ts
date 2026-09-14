import { useCallback, useEffect, useRef, useState } from "react";
// URL-owned selection only. Content/permissions are reconciled by the existing read hook.
export function useSearchChannelPreview() {
  const read = () => {
    const p = new URLSearchParams(window.location.search);
    return {
      roomId: p.get("previewRoom") ?? undefined,
      messageId: p.get("previewMessage") ?? undefined,
      threadId: p.get("previewThread") ?? undefined,
      rootMessageId: p.get("previewRoot") ?? undefined,
      tab: (p.get("previewTab") === "tasks"
        ? "tasks"
        : p.get("previewTab") === "files"
          ? "files"
          : "chat") as "chat" | "tasks" | "files",
    };
  };
  const focus = useRef<HTMLElement | undefined>(undefined);
  const [selection, setSelection] = useState(read);
  const { roomId, messageId, threadId, rootMessageId, tab } = selection;
  useEffect(() => {
    const pop = () => setSelection(read());
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const select = useCallback(
    (
      id: string | undefined,
      messageId?: string,
      threadId?: string,
      rootMessageId?: string,
    ) => {
      if (id)
        focus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : undefined;
      const params = new URLSearchParams(window.location.search);
      if (id) {
        params.set("previewRoom", id);
        params.set("room", id);
      } else params.delete("previewRoom");
      if (messageId) params.set("previewMessage", messageId);
      else params.delete("previewMessage");
      if (threadId) params.set("previewThread", threadId);
      else params.delete("previewThread");
      if (rootMessageId) params.set("previewRoot", rootMessageId);
      else params.delete("previewRoot");
      window.history.pushState(null, "", `?${params}`);
      setSelection(read());
      if (!id)
        queueMicrotask(() => {
          if (focus.current?.isConnected) focus.current.focus();
        });
    },
    [],
  );
  const open = useCallback(
    (
      id: string,
      messageId?: string,
      threadId?: string,
      rootMessageId?: string,
    ) => select(id, messageId, threadId, rootMessageId),
    [select],
  );
  const close = useCallback(() => select(undefined), [select]);
  const reset = useCallback(
    () =>
      setSelection({
        roomId: undefined,
        messageId: undefined,
        threadId: undefined,
        rootMessageId: undefined,
        tab: "chat",
      }),
    [],
  );
  const selectTab = useCallback((tab: "chat" | "tasks" | "files") => {
    const params = new URLSearchParams(window.location.search);
    params.set("previewTab", tab);
    window.history.replaceState(null, "", `?${params}`);
    setSelection(read());
  }, []);
  return {
    roomId,
    messageId,
    threadId,
    rootMessageId,
    tab,
    selectTab,
    open,
    close,
    reset,
  };
}
