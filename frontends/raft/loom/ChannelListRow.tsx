// Structural port of Sidebar.tsx ChannelRow; data and navigation belong to Loom.
// Keep upstream SidebarItem recipes, slot nesting and unread/muted state rules.
import { SidebarItem, SidebarItemCount, SidebarItemMetaIcon } from "raft-ui";
import { BellOff } from "lucide-react";
import { ChannelKindIcon } from "../packages/web/src/components/channel/channelKindIcon.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import { getChannelUnreadIndicatorState } from "../packages/web/src/utils/channelUnreadIndicator.ts";
export default function ChannelListRow({
  channelId,
  name,
  selected,
  menuOpen,
  unread,
  muted,
  onSelectChannel,
}: {
  channelId: string;
  name: string;
  selected: boolean;
  menuOpen: boolean;
  unread: number;
  muted: boolean;
  onSelectChannel: (id: string) => void;
}) {
  const { showLoudUnreadBadge, showQuietUnreadCount } =
    getChannelUnreadIndicatorState({
      unread,
      joined: true,
      showMutedIcon: muted,
    });
  return (
    <SidebarItem
      active={selected}
      onClick={() => onSelectChannel(channelId)}
      data-public-channel-id={channelId}
      data-slot="sidebar-item"
      className={`mx-0 w-full items-center ${selected ? "  " : menuOpen ? "bg-fill-muted" : ""}`}
    >
      <div className="flex size-[18px] shrink-0 items-center justify-center">
        <ChannelKindIcon type="channel" />
      </div>
      <span className="min-w-0 flex flex-1 items-center text-left">
        <span
          className={`min-w-0 text-sm truncate ${muted ? "text-foreground-muted " : ""} ${showLoudUnreadBadge ? "font-bold" : ""}`}
        >
          {name}
        </span>
        {muted && (
          <Tooltip content="已静音">
            <SidebarItemMetaIcon
              className="shrink-0"
              data-slot="sidebar-item-meta-icon"
              aria-label="已静音"
            >
              <BellOff size={12} />
            </SidebarItemMetaIcon>
          </Tooltip>
        )}
      </span>
      {showLoudUnreadBadge ? (
        <SidebarItemCount className="ml-auto" aria-label="有未读消息">
          {unread > 99 ? "99+" : unread}
        </SidebarItemCount>
      ) : showQuietUnreadCount ? (
        <span
          aria-label="有未读消息"
          className="ml-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium leading-none text-foreground-muted font-mono "
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </SidebarItem>
  );
}
