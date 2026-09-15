import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent,
  type MouseEvent,
} from "react";

/** Presentation only: a touch tap reveals one message toolbar; a scroll never does. */
export function useMessageActions(ref: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  const tap = useRef(false);
  const gesture = useRef<{ x: number; y: number; at: number } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!open) return;
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open, ref]);
  return {
    "data-actions-open": open || undefined,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      tap.current = false;
      gesture.current =
        event.pointerType === "touch"
          ? { x: event.clientX, y: event.clientY, at: Date.now() }
          : undefined;
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const start = gesture.current;
      if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
      ) {
        gesture.current = undefined;
        setOpen(false);
      }
    },
    onPointerCancel: () => {
      gesture.current = undefined;
      setOpen(false);
    },
    // Do not change the DOM before Safari dispatches the synthesized click.
    onPointerUp: () => {
      const start = gesture.current;
      tap.current = !!start && Date.now() - start.at < 500;
      gesture.current = undefined;
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (window.matchMedia("(max-width: 767px)").matches) return;
      const reveal = tap.current;
      tap.current = false;
      if (!reveal || !(event.target instanceof Element)) return;
      if (
        event.target.closest(
          'a, button, input, select, textarea, label, [role="button"], [role="link"]',
        )
      )
        return;
      setOpen(true);
    },
  };
}
