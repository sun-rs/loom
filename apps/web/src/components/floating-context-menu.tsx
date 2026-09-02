import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  floatingContextMenuPosition,
  nextContextMenuItemIndex,
  type FloatingContextMenuDirection,
} from "../floating-context-menu-model.ts";

export type FloatingContextMenuAnchor = Readonly<{
  x: number;
  y: number;
}>;

export function FloatingContextMenu({
  anchor,
  ariaLabel,
  backdropClassName,
  children,
  className,
  onClose,
  triggerRef,
}: {
  anchor: FloatingContextMenuAnchor;
  ariaLabel: string;
  backdropClassName: string;
  children: ReactNode;
  className: string;
  onClose: () => void;
  triggerRef?: RefObject<HTMLElement | null>;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);
  const dismiss = (restoreFocus: boolean) => {
    onClose();
    if (restoreFocus)
      queueMicrotask(() => {
        triggerRef?.current?.focus();
      });
  };

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPosition(
      floatingContextMenuPosition({
        anchorX: anchor.x,
        anchorY: anchor.y,
        menuWidth: bounds.width,
        menuHeight: bounds.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      }),
    );
  }, [anchor]);

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled), button[role="menuitemradio"]:not(:disabled)',
      )
      ?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss(true);
    };
    const closeWithoutFocus = () => dismiss(false);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeWithoutFocus);
    window.addEventListener("scroll", closeWithoutFocus, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeWithoutFocus);
      window.removeEventListener("scroll", closeWithoutFocus, true);
    };
  }, [onClose, triggerRef]);

  function moveFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    const direction: FloatingContextMenuDirection | undefined =
      event.key === "ArrowDown"
        ? "next"
        : event.key === "ArrowUp"
          ? "previous"
          : event.key === "Home"
            ? "first"
            : event.key === "End"
              ? "last"
              : undefined;
    if (!direction) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]:not(:disabled), button[role="menuitemradio"]:not(:disabled)',
      ) ?? [],
    );
    const enabled = items.map((_, index) => index);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextContextMenuItemIndex(enabled, current, direction);
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  }

  return createPortal(
    <>
      <div
        className={backdropClassName}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={() => dismiss(false)}
      />
      <div
        aria-label={ariaLabel}
        className={className}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={moveFocus}
        ref={menuRef}
        role="menu"
        style={{ left: position.x, top: position.y }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
