import type { SidebarRoomAttention } from "../attention-presentation.ts";
import { sidebarRoomAttention } from "../attention-presentation.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

export function ChannelRowIdentity({
  muted,
  name,
}: {
  muted: boolean;
  name: string;
}) {
  const showMuted = sidebarRoomAttention("channel", undefined, muted).showMuted;
  return (
    <span className="rah-sidebar-channel-identity">
      <span className="rah-sidebar-channel-name">{name}</span>
      {showMuted ? (
        <span
          className="rah-room-muted"
          aria-label="已静音频道活动"
          title="频道活动已静音"
        >
          <Icon name="bell-off" />
        </span>
      ) : null}
    </span>
  );
}

export function RoomAttentionBadges({
  kind,
  quiet = false,
  value,
}: {
  kind: "channel" | "direct";
  quiet?: boolean;
  value: SidebarRoomAttention | undefined;
}) {
  const attention = sidebarRoomAttention(kind, value, quiet);
  return attention.showMention || attention.unreadCount > 0 ? (
    <span className="rah-room-attention">
      {attention.showMention ? (
        <span
          className="rah-room-mention"
          aria-label="有未读消息提及你"
          title="提及了你"
        >
          <Icon name="at-sign" />
        </span>
      ) : null}
      {attention.unreadCount > 0 ? (
        <span
          className={`rah-room-unread${attention.unreadTone === "quiet" ? " is-quiet" : ""}`}
          aria-label={`${attention.unreadCount} 条未读`}
        >
          {attention.unreadCount > 99 ? "99+" : attention.unreadCount}
        </span>
      ) : null}
    </span>
  ) : null;
}
