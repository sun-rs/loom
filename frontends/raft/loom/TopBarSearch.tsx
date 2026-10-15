import { useCallback, useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import type { RahClient } from "@rah-os/client-sdk";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import SearchOverlay from "../packages/web/src/components/search/SearchOverlay.tsx";
import { OverlaySearchContext } from "./SearchOverlayContent.tsx";
import TopBar from "./TopBar.tsx";
import { hasRouteBoundIntent } from "./useIntentRoute.ts";
import { searchBackground } from "./useSearchPresentation.ts";
import { loadChannelDirectory } from "./channel-client.ts";
export default function TopBarSearch({
  client,
  directory,
  onDirectory,
}: {
  client: RahClient;
  directory: Awaited<ReturnType<typeof loadChannelDirectory>>;
  onDirectory: (
    value: Awaited<ReturnType<typeof loadChannelDirectory>>,
  ) => void;
}) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const desktop = useMediaQuery("(min-width: 768px)");
  const background = searchBackground(location.search, location.state);
  const opener = useRef<HTMLElement | null>(null);
  const locationRef = useRef(location);
  locationRef.current = location;
  const open = useCallback(() => {
    if (hasRouteBoundIntent() || background !== null) return;
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const next = new URLSearchParams({ view: "search" });
    setParams(next, {
      state: desktop ? { loomSearchBackground: location.search } : null,
    });
  }, [desktop, background, location.search, setParams]);
  const close = useCallback(() => {
    if (background === null || hasRouteBoundIntent()) return;
    setParams(new URLSearchParams(background), { replace: true, state: null });
    requestAnimationFrame(() => {
      if (opener.current?.isConnected)
        opener.current.focus({ preventScroll: true });
    });
  }, [background, setParams]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        e.keyCode === 229 ||
        e.altKey ||
        !((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")
      )
        return;
      e.preventDefault();
      open();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);
  // Match the native responsive rule: narrow screens use the real full search route.
  useEffect(() => {
    if (!desktop && background !== null)
      setParams(params, { replace: true, state: null });
  }, [desktop, background]);
  return (
    <>
      {desktop && <TopBar name={directory.workspace.name} onSearch={open} />}
      {desktop && background !== null && (
        <OverlaySearchContext.Provider
          value={{
            client,
            workspaceId: directory.workspace.workspaceId,
            mode: "search",
            onBack: close,
            onOpenResult: async (row) => {
              if (hasUnresolvedIntents()) throw Error("仍有未决操作");
              const started = locationRef.current;
              const context = await client.request("message.context", {
                roomId: row.message.roomId,
                messageId: row.message.messageId,
              });
              if (
                context.message.roomId !== row.message.roomId ||
                context.message.messageId !== row.message.messageId
              )
                throw Error("消息身份不一致");
              const next = await loadChannelDirectory(client);
              if (
                ![
                  ...next.channels,
                  ...next.archivedChannels,
                  ...next.privateBoxes,
                ].some((r) => r.roomId === row.message.roomId)
              )
                throw Error("对话不可用");
              if (context.message.threadId && !context.rootMessageId)
                throw Error("消息列根消息缺失");
              if (locationRef.current !== started || hasUnresolvedIntents())
                return;
              const target = new URLSearchParams({
                room: row.message.roomId,
                message: row.message.messageId,
              });
              if (context.rootMessageId && context.message.threadId)
                target.set("thread", context.rootMessageId);
              onDirectory(next);
              setParams(target, { state: null });
            },
          }}
        >
          <SearchOverlay onClose={close} />
        </OverlaySearchContext.Provider>
      )}
    </>
  );
}
