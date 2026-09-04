import { useRef, useState, type PointerEvent } from "react";

export type PanelResizeProps = {
  width: number;
  onWidthChange: (width: number) => void;
  onWidthCommit?: ((width: number) => void) | undefined;
};

// Single pointer/capture owner. Width policy and persistence remain with each
// existing panel. No storage, navigation, provider, or business state here.
export function PanelResizer({
  width,
  onWidthChange,
  onWidthCommit,
  label,
  className,
  min,
  max,
  direction,
  clamp,
  nextWidth,
  testId,
  highlight = true,
}: PanelResizeProps & {
  label: string;
  className: string;
  min: number;
  max: number;
  direction: 1 | -1;
  clamp: (width: number) => number;
  nextWidth: (width: number, key: string) => number | undefined;
  testId?: string;
  highlight?: boolean;
}) {
  const origin = useRef<
    { pointerId: number; x: number; width: number; latest: number } | undefined
  >(undefined);
  const [dragging, setDragging] = useState(false);
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const drag = origin.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Clear before releasing capture: lostpointercapture must not commit twice.
    origin.current = undefined;
    setDragging(false);
    onWidthCommit?.(drag.latest);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={width}
      className={`rah-panel-resizer ${className}${dragging ? " is-dragging" : ""}`}
      data-testid={testId}
      data-highlight={highlight}
      onKeyDown={(event) => {
        const next = nextWidth(width, event.key);
        if (next === undefined) return;
        event.preventDefault();
        onWidthChange(next);
        onWidthCommit?.(next);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || origin.current) return;
        origin.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          width,
          latest: width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const drag = origin.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.latest = clamp(drag.width + direction * (event.clientX - drag.x));
        onWidthChange(drag.latest);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      role="separator"
      tabIndex={0}
    />
  );
}
