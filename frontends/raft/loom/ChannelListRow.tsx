import { OfficialMarkedUnread } from "./OfficialContextMenu138.generated.js";
import { sidebarItemClass139 } from "./OfficialSidebar139.generated.js";
// Structural port of Sidebar.tsx ChannelRow; data and navigation belong to Loom.
// Keep upstream SidebarItem recipes, slot nesting and unread/muted state rules.
import {
  SidebarItem,
  SidebarItemChannelIcon,
  SidebarItemContent,
  SidebarItemTitle,
  SidebarItemCount,
  SidebarItemMetaIcon,
} from "raft-ui";
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
  markedUnread,
  muted,
  onSelectChannel,
}: {
  channelId: string;
  name: string;
  selected: boolean;
  menuOpen: boolean;
  unread: number;
  markedUnread?: boolean;
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
      tone={muted ? "muted" : showLoudUnreadBadge ? "unread" : "default"}
      onClick={() => onSelectChannel(channelId)}
      data-public-channel-id={channelId}
      data-slot="sidebar-item"
      className={sidebarItemClass139(selected, menuOpen)}
    >
      <SidebarItemChannelIcon>
        <ChannelKindIcon type="channel" size={16} />
      </SidebarItemChannelIcon>
      <SidebarItemContent className="items-center">
        <SidebarItemTitle>{name}</SidebarItemTitle>
        {muted && (
          <Tooltip content="已静音">
            <SidebarItemMetaIcon
              className="shrink-0"
              data-slot="sidebar-item-meta-icon"
              aria-label="已静音"
            >
              <BellOff size={14} />
            </SidebarItemMetaIcon>
          </Tooltip>
        )}
      </SidebarItemContent>
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
      ) : markedUnread ? (
        <OfficialMarkedUnread className="ml-auto" aria-label="已标记未读" />
      ) : null}
    </SidebarItem>
  );
}
