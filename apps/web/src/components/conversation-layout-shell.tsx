import {
  createContext,
  useContext,
  useLayoutEffect,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import { useRoomSidebarWidth } from "../use-room-sidebar-width.ts";
import { useThreadPanelWidth } from "../use-thread-panel-width.ts";
import { useConversationLayout } from "../use-conversation-layout.ts";
import {
  SearchPreviewResizer,
  useSearchPreviewWidth,
} from "./search-preview-resizer.tsx";
import { RoomSidebarResizer } from "./room-sidebar-resizer.tsx";
import { ThreadPanelResizer } from "./thread-panel-resizer.tsx";
import type { conversationLayout } from "../conversation-layout.ts";

type Mode = ReturnType<typeof conversationLayout>;
const Widths = createContext<{
  room: ReturnType<typeof useRoomSidebarWidth>;
  thread: ReturnType<typeof useThreadPanelWidth>;
  search: ReturnType<typeof useSearchPreviewWidth>;
  activity: ReturnType<typeof useSearchPreviewWidth>;
} | null>(null);

/** Presentation owner. Width changes rerender this shell and its grips, not
 * WorkspaceScreen or its stable children. Only folding crosses that boundary. */
export function ConversationLayoutShell({
  scope,
  compact,
  onModeChange,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  scope: "room" | "search" | "activity";
  compact: boolean;
  onModeChange: (mode: Mode) => void;
}) {
  const room = useRoomSidebarWidth();
  const thread = useThreadPanelWidth();
  const search = useSearchPreviewWidth("search", compact);
  const activity = useSearchPreviewWidth("activity", compact);
  const sidebar =
    scope === "room"
      ? room.width
      : scope === "search"
        ? search.width
        : activity.width;
  const layout = useConversationLayout(sidebar);
  useLayoutEffect(() => onModeChange(layout.mode), [layout.mode, onModeChange]);
  return (
    <Widths.Provider value={{ room, thread, search, activity }}>
      <div
        {...props}
        ref={layout.ref}
        data-conversation-layout={layout.mode}
        style={
          {
            ...props.style,
            "--rah-room-sidebar-width": `${sidebar}px`,
            "--thread-w": `${thread.width}px`,
            "--rah-search-width": `${search.width}px`,
          } as CSSProperties
        }
      >
        {children}
      </div>
    </Widths.Provider>
  );
}

export function ConversationLayoutResizer({
  kind,
}: {
  kind: "room" | "thread" | "profile" | "search" | "activity";
}) {
  const widths = useContext(Widths);
  if (!widths)
    throw new Error("Conversation resizer requires its layout owner");
  if (kind === "search" || kind === "activity")
    return (
      <SearchPreviewResizer
        layout={widths[kind]}
        label={kind === "search" ? "调整搜索结果宽度" : "调整动态列表宽度"}
      />
    );
  const layout = kind === "room" ? widths.room : widths.thread;
  const props = {
    width: layout.width,
    onWidthChange: layout.setWidth,
    onWidthCommit: layout.commit,
  };
  return kind === "room" ? (
    <RoomSidebarResizer {...props} />
  ) : (
    <ThreadPanelResizer {...props} inspector={kind === "profile"} />
  );
}
