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
import { useProfilePanelWidth } from "../use-profile-panel-width.ts";
import { ProfilePanelResizer } from "./profile-panel-resizer.tsx";
import type { conversationLayout } from "../conversation-layout.ts";

type Mode = ReturnType<typeof conversationLayout>;
const Widths = createContext<{
  profile: ReturnType<typeof useProfilePanelWidth>;
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
  panelKind = "thread",
  onModeChange,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  scope: "room" | "search" | "activity";
  compact: boolean;
  panelKind?: "thread" | "profile";
  onModeChange: (mode: Mode) => void;
}) {
  const room = useRoomSidebarWidth();
  const profile = useProfilePanelWidth();
  const thread = useThreadPanelWidth();
  const search = useSearchPreviewWidth(compact);
  const activity = search;
  const sidebar =
    scope === "room"
      ? room.width
      : scope === "search"
        ? search.width
        : activity.width;
  const layout = useConversationLayout(sidebar, panelKind);
  useLayoutEffect(() => onModeChange(layout.mode), [layout.mode, onModeChange]);
  return (
    <Widths.Provider value={{ room, thread, profile, search, activity }}>
      <div
        {...props}
        ref={layout.ref}
        data-conversation-layout={layout.mode}
        style={
          {
            ...props.style,
            "--rah-room-sidebar-width": `${sidebar}px`,
            "--rah-conversation-profile-width": `${profile.width}px`,
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
  const layout =
    kind === "room"
      ? widths.room
      : kind === "profile"
        ? widths.profile
        : widths.thread;
  const props = {
    width: layout.width,
    onWidthChange: layout.setWidth,
    onWidthCommit: layout.commit,
    onWidthReset: () => {
      const value = kind === "room" ? 240 : kind === "profile" ? 380 : 400;
      layout.setWidth(value);
      layout.commit(value);
    },
  };
  return kind === "room" ? (
    <RoomSidebarResizer {...props} />
  ) : kind === "profile" ? (
    <ProfilePanelResizer {...props} conversation />
  ) : (
    <ThreadPanelResizer {...props} />
  );
}
