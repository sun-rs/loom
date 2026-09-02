import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import {
  clampProfilePanelWidth,
  nextProfilePanelWidth,
  RAFT_PROFILE_PANEL_MAX_WIDTH,
  RAFT_PROFILE_PANEL_MIN_WIDTH,
} from "../profile-panel-resize.ts";

type DragOrigin = { pointerId: number; pointerX: number; width: number };

export function ProfilePanelResizer({
  onWidthChange,
  onWidthCommit,
  width,
}: {
  onWidthChange: (width: number) => void;
  onWidthCommit: (width: number) => void;
  width: number;
}) {
  const dragOrigin = useRef<DragOrigin | undefined>(undefined);
  const latestWidth = useRef(width);
  const [dragging, setDragging] = useState(false);
  latestWidth.current = width;

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current?.pointerId !== event.pointerId) return;
    dragOrigin.current = undefined;
    setDragging(false);
    onWidthCommit(latestWidth.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextWidth = nextProfilePanelWidth(width, event.key);
    if (nextWidth === undefined) return;
    event.preventDefault();
    onWidthChange(nextWidth);
    onWidthCommit(nextWidth);
  };

  return (
    <div
      aria-label="调整 Agent 资料面板宽度"
      aria-orientation="vertical"
      aria-valuemax={RAFT_PROFILE_PANEL_MAX_WIDTH}
      aria-valuemin={RAFT_PROFILE_PANEL_MIN_WIDTH}
      aria-valuenow={width}
      className={`rah-agent-profile-resizer${dragging ? " is-dragging" : ""}`}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={() => {
        if (dragOrigin.current === undefined) return;
        dragOrigin.current = undefined;
        setDragging(false);
        onWidthCommit(latestWidth.current);
      }}
      onPointerCancel={finishDrag}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        latestWidth.current = width;
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
        const nextWidth = clampProfilePanelWidth(
          origin.width + origin.pointerX - event.clientX,
        );
        latestWidth.current = nextWidth;
        onWidthChange(nextWidth);
      }}
      onPointerUp={finishDrag}
      role="separator"
      tabIndex={0}
    />
  );
}
