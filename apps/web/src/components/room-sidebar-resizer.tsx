import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import {
  clampRoomSidebarWidth,
  nextRoomSidebarWidth,
  RAFT_ROOM_SIDEBAR_MAX_WIDTH,
  RAFT_ROOM_SIDEBAR_MIN_WIDTH,
} from "../room-sidebar-resize.ts";

type DragOrigin = {
  pointerId: number;
  pointerX: number;
  width: number;
};

export function RoomSidebarResizer({
  onWidthChange,
  width,
}: {
  onWidthChange: (width: number) => void;
  width: number;
}) {
  const dragOrigin = useRef<DragOrigin | undefined>(undefined);
  const [dragging, setDragging] = useState(false);

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current?.pointerId !== event.pointerId) return;
    dragOrigin.current = undefined;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextWidth = nextRoomSidebarWidth(width, event.key);
    if (nextWidth === undefined) return;
    event.preventDefault();
    onWidthChange(nextWidth);
  };

  return (
    <div
      aria-label="调整聊天边栏宽度"
      aria-orientation="vertical"
      aria-valuemax={RAFT_ROOM_SIDEBAR_MAX_WIDTH}
      aria-valuemin={RAFT_ROOM_SIDEBAR_MIN_WIDTH}
      aria-valuenow={width}
      className={`rah-room-sidebar-resizer${dragging ? " is-dragging" : ""}`}
      onKeyDown={handleKeyDown}
      onPointerCancel={finishDrag}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragOrigin.current = {
          pointerId: event.pointerId,
          pointerX: event.clientX,
          width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const origin = dragOrigin.current;
        if (origin?.pointerId !== event.pointerId) return;
        onWidthChange(
          clampRoomSidebarWidth(origin.width + event.clientX - origin.pointerX),
        );
      }}
      onPointerUp={finishDrag}
      role="separator"
      tabIndex={0}
    />
  );
}
