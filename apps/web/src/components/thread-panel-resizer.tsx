import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import {
  clampThreadPanelWidth,
  nextThreadPanelWidth,
  RAFT_THREAD_PANEL_MIN_WIDTH,
  threadPanelMaxWidth,
} from "../thread-panel-resize.ts";

type DragOrigin = { pointerId: number; pointerX: number; width: number };

export function ThreadPanelResizer({
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
    const next = nextThreadPanelWidth(width, event.key, window.innerWidth);
    if (next === undefined) return;
    event.preventDefault();
    onWidthChange(next);
    onWidthCommit(next);
  };

  return (
    <div
      aria-label="调整消息列宽度"
      aria-orientation="vertical"
      aria-valuemax={threadPanelMaxWidth(window.innerWidth)}
      aria-valuemin={RAFT_THREAD_PANEL_MIN_WIDTH}
      aria-valuenow={width}
      className={`rah-thread-resizer${dragging ? " is-dragging" : ""}`}
      data-testid="thread-side-column-resizer"
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
        dragOrigin.current = {
          pointerId: event.pointerId,
          pointerX: event.clientX,
          width,
        };
        latestWidth.current = width;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const origin = dragOrigin.current;
        if (origin?.pointerId !== event.pointerId) return;
        const next = clampThreadPanelWidth(
          origin.width + origin.pointerX - event.clientX,
          window.innerWidth,
        );
        latestWidth.current = next;
        onWidthChange(next);
      }}
      onPointerUp={finishDrag}
      role="separator"
      tabIndex={0}
    />
  );
}
