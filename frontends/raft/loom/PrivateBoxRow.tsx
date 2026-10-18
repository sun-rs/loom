// Structural port of official Sidebar.tsx DmRow. Loom supplies identity/unread;
// native AvatarSlot and SidebarItem own size, palette, hover and selected states.
import { SidebarItem, SidebarItemCount } from "raft-ui";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
export default function PrivateBoxRow({
  roomId,
  name,
  description,
  selected,
  menuOpen,
  unread,
  allowWrap,
  onSelect,
}: {
  roomId: string;
  name: string;
  description?: string;
  selected: boolean;
  menuOpen: boolean;
  unread: number;
  allowWrap: boolean;
  onSelect: () => void;
}) {
  return (
    <SidebarItem
      data-private-box-id={roomId}
      data-sidebar-channel-id={roomId}
      data-slot="sidebar-item"
      active={selected}
      onClick={onSelect}
      className={`mx-0 w-full ${allowWrap ? "items-start whitespace-normal" : "items-center"} ${selected ? "  " : menuOpen ? "bg-fill-muted" : ""}`}
    >
      <AvatarSlot context="sidebar-list" type="agent" agentAvatarUrl={null} />
      <div
        className={`flex min-w-0 flex-1 ${allowWrap ? "flex-col items-start gap-0.5" : "items-baseline gap-1"} text-left`}
      >
        <span
          className={`${allowWrap ? "min-w-0 max-w-full whitespace-normal break-words leading-tight" : "min-w-0 truncate"} text-sm ${unread > 0 ? "font-bold" : ""}`}
        >
          {name}
        </span>
        {description && (
          <span
            className={`min-w-0 ${allowWrap ? "max-w-full whitespace-normal break-words leading-tight" : "flex-1 truncate"} text-xs text-foreground-muted `}
          >
            {description}
          </span>
        )}
      </div>
      <span className="flex shrink-0 self-center items-center gap-1.5">
        {unread > 0 && (
          <SidebarItemCount className="" aria-label="有未读消息">
            {unread > 99 ? "99+" : unread}
          </SidebarItemCount>
        )}
      </span>
    </SidebarItem>
  );
}
