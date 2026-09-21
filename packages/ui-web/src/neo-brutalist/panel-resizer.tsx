import { useRef, useState, type PointerEvent, type KeyboardEvent } from "react";

export type PanelResizeProps = {
  onWidthReset?: (() => void) | undefined;
  measureParent?: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onWidthCommit?: ((width: number) => void) | undefined;
};

// Shared pointer/capture owner; visual wrappers retain their existing CSS.
export function usePanelResize({
  width,
  onWidthChange,
  onWidthCommit,
  onWidthReset,
  measureParent = false,
  direction,
  clamp,
  nextWidth,
  preventSelection = true,
}: PanelResizeProps & {
  direction: 1 | -1;
  clamp: (width: number) => number;
  nextWidth: (
    width: number,
    key: string,
    shiftKey: boolean,
  ) => number | undefined;
  preventSelection?: boolean;
}) {
  const origin = useRef<
    | {
        pointerId: number;
        x: number;
        width: number;
        latest: number;
        changed: boolean;
      }
    | undefined
  >(undefined);
  const [dragging, setDragging] = useState(false);
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const drag = origin.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // Clear before releasing capture: lostpointercapture must not commit twice.
    origin.current = undefined;
    setDragging(false);
    if (drag.changed) onWidthCommit?.(drag.latest);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return {
    dragging,
    onDoubleClick: onWidthReset,
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" && onWidthReset) {
        event.preventDefault();
        onWidthReset();
        return;
      }
      const next = nextWidth(width, event.key, event.shiftKey);
      if (next === undefined) return;
      event.preventDefault();
      onWidthChange(next);
      onWidthCommit?.(next);
    },
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || origin.current) return;
      const start = measureParent
        ? (event.currentTarget.parentElement?.getBoundingClientRect().width ??
          width)
        : width;
      origin.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        width: start,
        latest: width,
        changed: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      if (preventSelection) event.preventDefault();
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const drag = origin.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.changed && event.clientX === drag.x) return;
      drag.changed = true;
      drag.latest = clamp(drag.width + direction * (event.clientX - drag.x));
      onWidthChange(drag.latest);
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  };
}

export function PanelResizer({
  label,
  className,
  min,
  max,
  testId,
  highlight = true,
  ...props
}: Parameters<typeof usePanelResize>[0] & {
  label: string;
  className: string;
  min: number;
  max: number;
  testId?: string;
  highlight?: boolean;
}) {
  const { dragging, ...handlers } = usePanelResize(props);
  return (
    <div
      {...handlers}
      aria-label={label}
      title={props.onWidthReset ? "双击或按 Enter 恢复默认宽度" : undefined}
      aria-orientation="vertical"
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={props.width}
      className={`rah-panel-resizer ${className}${dragging ? " is-dragging" : ""}`}
      data-testid={testId}
      data-highlight={highlight}
      role="separator"
      tabIndex={0}
    />
  );
}
