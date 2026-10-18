import { useCallback } from "react";
import { SidebarItem } from "raft-ui";
import { ChannelKindIcon } from "../channel/channelKindIcon";

/** One channel row of the public server page's channel column. It owns its
 *  click closure so the list passes only stable references. The classes mirror
 *  the signed-in Sidebar row; see PublicServerChannelSidebar. */
export default function PublicServerChannelRow({
  channelId,
  name,
  selected,
  onSelectChannel,
}: {
  channelId: string;
  name: string;
  selected: boolean;
  onSelectChannel: (channelId: string) => void;
}) {
  const handleClick = useCallback(() => onSelectChannel(channelId), [channelId, onSelectChannel]);
  return (
    <SidebarItem
      active={selected}
      onClick={handleClick}
      className={`mx-0 w-full items-center ${selected ? "  " : ""}`}
      data-public-channel-id={channelId}
    >
      <div className="flex size-[18px] shrink-0 items-center justify-center">
        <ChannelKindIcon type="channel" />
      </div>
      <span className="flex min-w-0 flex-1 items-center text-left">
        <span className="min-w-0 truncate text-sm">{name}</span>
      </span>
    </SidebarItem>
  );
}
