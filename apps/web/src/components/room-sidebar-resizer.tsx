import {
  PanelResizer,
  type PanelResizeProps,
} from "@rah-os/ui-web/neo-brutalist/panel-resizer";
import {
  clampRoomSidebarWidth,
  nextRoomSidebarWidth,
  RAFT_ROOM_SIDEBAR_MIN_WIDTH,
  RAFT_ROOM_SIDEBAR_MAX_WIDTH,
} from "../room-sidebar-resize.ts";

export function RoomSidebarResizer(props: PanelResizeProps) {
  return (
    <PanelResizer
      {...props}
      label="调整聊天边栏宽度"
      className="rah-room-sidebar-resizer"
      direction={1}
      min={RAFT_ROOM_SIDEBAR_MIN_WIDTH}
      max={RAFT_ROOM_SIDEBAR_MAX_WIDTH}
      clamp={clampRoomSidebarWidth}
      nextWidth={nextRoomSidebarWidth}
    />
  );
}
