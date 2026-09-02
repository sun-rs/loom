import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TouchEvent as ReactTouchEvent,
} from "react";

export const MESSAGE_LONG_PRESS_MS = 500;

export function useMessageContextMenu<T extends HTMLElement>() {
  const triggerRef = useRef<T>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const longPressOpened = useRef(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number }>();

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = undefined;
  }, []);
  const closeContextMenu = useCallback(() => setAnchor(undefined), []);
  const openContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (
      !(event.target instanceof Element) ||
      event.target.closest('a[target="_blank"]')
    )
      return;
    event.preventDefault();
    setAnchor({ x: event.clientX, y: event.clientY });
  }, []);
  const startContextMenuLongPress = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      if (
        !(event.target instanceof Element) ||
        event.target.closest("a, button, pre, code, img")
      )
        return;
      cancelLongPress();
      longPressOpened.current = false;
      const touch = event.touches[0];
      if (!touch) return;
      longPressTimer.current = setTimeout(() => {
        longPressOpened.current = true;
        setAnchor({ x: touch.clientX, y: touch.clientY });
      }, MESSAGE_LONG_PRESS_MS);
    },
    [cancelLongPress],
  );
  const finishContextMenuLongPress = useCallback(
    (event: ReactTouchEvent<HTMLElement>) => {
      cancelLongPress();
      if (longPressOpened.current) event.preventDefault();
    },
    [cancelLongPress],
  );

  useEffect(() => cancelLongPress, [cancelLongPress]);

  return {
    anchor,
    closeContextMenu,
    finishContextMenuLongPress,
    moveContextMenuLongPress: cancelLongPress,
    openContextMenu,
    startContextMenuLongPress,
    triggerRef,
  };
}
