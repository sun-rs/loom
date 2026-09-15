import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useEffect,
  useLayoutEffect,
  useRef,
  type ForwardedRef,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
  type RefObject,
} from "react";

import { useVirtualizer } from "@tanstack/react-virtual";

const RAFT_MESSAGE_ESTIMATED_HEIGHT = 82;
const RAFT_MESSAGE_OVERSCAN = 6;
const RAFT_MESSAGE_ANCHOR_SETTLE_MS = 1_200;

export type MessageTimelineHandle = {
  scrollToMessage: (messageId: string) => void;
  scrollToLatest: () => void;
  cancelPendingAnchor: () => void;
  preserveAnchorOnNextChange: (
    messageId: string,
    viewportOffset: number,
  ) => void;
};

type MessageTimelineProps<Item> = {
  followOnAppend: boolean;
  getItemKey: (item: Item) => string;
  header?: ReactNode;
  items: readonly Item[];
  renderItem: (item: Item, index: number) => ReactNode;
  scrollElementRef: RefObject<HTMLElement | null>;
};

function MessageTimelineInner<Item>(
  {
    followOnAppend,
    getItemKey,
    header,
    items,
    renderItem,
    scrollElementRef,
  }: MessageTimelineProps<Item>,
  forwardedRef: ForwardedRef<MessageTimelineHandle>,
) {
  const itemsRef = useRef(items);
  const getItemKeyRef = useRef(getItemKey);
  const hasHeaderRef = useRef(header !== undefined);
  const pendingAnchorRef = useRef<
    | {
        messageId: string;
        previousItemIndex: number;
        viewportOffset: number;
        scrollTop: number;
        settleDeadline?: number;
      }
    | undefined
  >(undefined);
  itemsRef.current = items;
  getItemKeyRef.current = getItemKey;
  hasHeaderRef.current = header !== undefined;
  const stableItemKey = useCallback((index: number) => {
    if (hasHeaderRef.current && index === 0) {
      return "rah-message-timeline-header";
    }
    const itemIndex = index - (hasHeaderRef.current ? 1 : 0);
    const item = itemsRef.current[itemIndex];
    if (item === undefined) return `missing-message-${String(index)}`;
    return getItemKeyRef.current(item);
  }, []);
  const headerOffset = header === undefined ? 0 : 1;
  const virtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    anchorTo: "end",
    count: items.length + headerOffset,
    directDomUpdates: true,
    directDomUpdatesMode: "position",
    estimateSize: (index) =>
      headerOffset === 1 && index === 0 ? 46 : RAFT_MESSAGE_ESTIMATED_HEIGHT,
    followOnAppend,
    getItemKey: stableItemKey,
    getScrollElement: () => scrollElementRef.current,
    initialRect: { height: 800, width: 320 },
    overscan: RAFT_MESSAGE_OVERSCAN,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });

  useImperativeHandle(
    forwardedRef,
    () => ({
      scrollToLatest() {
        if (itemsRef.current.length > 0)
          virtualizer.scrollToIndex(
            itemsRef.current.length - 1 + (hasHeaderRef.current ? 1 : 0),
            { align: "end" },
          );
      },
      scrollToMessage(messageId) {
        const index = itemsRef.current.findIndex(
          (item) => getItemKeyRef.current(item) === messageId,
        );
        if (index >= 0)
          virtualizer.scrollToIndex(index + (hasHeaderRef.current ? 1 : 0), {
            align: "center",
          });
      },
      cancelPendingAnchor() {
        pendingAnchorRef.current = undefined;
      },
      preserveAnchorOnNextChange(messageId, viewportOffset) {
        pendingAnchorRef.current = {
          messageId,
          previousItemIndex: itemsRef.current.findIndex(
            (item) => getItemKeyRef.current(item) === messageId,
          ),
          viewportOffset,
          scrollTop: scrollElementRef.current?.scrollTop ?? 0,
        };
      },
    }),
    [],
  );

  useEffect(() => {
    const scroller = scrollElementRef.current;
    if (!scroller) return;
    // While a history request is pending, keep its anchor relative to the
    // user's latest reading position rather than the original click position.
    const update = () => {
      const pending = pendingAnchorRef.current;
      if (!pending || pending.settleDeadline !== undefined) return;
      const index = itemsRef.current.findIndex(
        (item) => getItemKeyRef.current(item) === pending.messageId,
      );
      if (index !== pending.previousItemIndex) return;
      pending.viewportOffset -= scroller.scrollTop - pending.scrollTop;
      pending.scrollTop = scroller.scrollTop;
    };
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, [scrollElementRef]);

  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current;
    const scroller = scrollElementRef.current;
    if (pending === undefined || scroller === null) return;
    const itemIndex = items.findIndex(
      (item) => getItemKey(item) === pending.messageId,
    );
    if (itemIndex < 0) {
      pendingAnchorRef.current = undefined;
      return;
    }
    if (itemIndex === pending.previousItemIndex) return;
    let animationFrame = 0;
    let cancelled = false;
    const settleDeadline = (pending.settleDeadline ??=
      performance.now() + RAFT_MESSAGE_ANCHOR_SETTLE_MS);
    const release = () => {
      pendingAnchorRef.current = undefined;
    };
    const releaseOnKey = (event: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        release();
    };
    scroller.addEventListener("wheel", release, { passive: true });
    scroller.addEventListener("touchmove", release, { passive: true });
    scroller.addEventListener("keydown", releaseOnKey);
    const settle = () => {
      if (cancelled || pendingAnchorRef.current !== pending) return;
      const row = scroller.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(pending.messageId)}"]`,
      );
      if (row === null) {
        // An index target keeps reconciling after our correction is released.
        // Prepend restoration needs a bounded offset, not a new navigation target.
        const offset = virtualizer.getOffsetForIndex(
          itemIndex + headerOffset,
          "start",
        );
        if (offset)
          virtualizer.scrollToOffset(offset[0] - pending.viewportOffset);
      } else {
        const delta =
          row.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          pending.viewportOffset;
        if (Math.abs(delta) > 0.5)
          virtualizer.scrollToOffset(scroller.scrollTop + delta);
      }
      if (performance.now() < settleDeadline) {
        animationFrame = requestAnimationFrame(settle);
      } else {
        pendingAnchorRef.current = undefined;
      }
    };
    animationFrame = requestAnimationFrame(() => {
      animationFrame = requestAnimationFrame(settle);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      scroller.removeEventListener("wheel", release);
      scroller.removeEventListener("touchmove", release);
      scroller.removeEventListener("keydown", releaseOnKey);
    };
  }, [getItemKey, headerOffset, items, scrollElementRef, virtualizer]);

  return (
    <div
      className="rah-message-timeline"
      data-message-timeline-total-count={items.length}
      ref={virtualizer.containerRef}
      style={{
        position: "relative",
        width: "100%",
      }}
    >
      {virtualizer.getVirtualItems().map((virtualItem) => {
        const isHeader = headerOffset === 1 && virtualItem.index === 0;
        const itemIndex = virtualItem.index - headerOffset;
        const item = items[itemIndex];
        if (isHeader) {
          return (
            <div
              className="rah-message-virtual-row rah-message-virtual-header"
              data-index={virtualItem.index}
              data-message-virtual-key={String(virtualItem.key)}
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              style={{
                left: 0,
                position: "absolute",
                width: "100%",
              }}
            >
              {header}
            </div>
          );
        }
        if (item === undefined) return null;
        return (
          <div
            className="rah-message-virtual-row"
            data-index={virtualItem.index}
            data-message-virtual-key={String(virtualItem.key)}
            key={virtualItem.key}
            ref={virtualizer.measureElement}
            style={{
              left: 0,
              position: "absolute",
              width: "100%",
            }}
          >
            {renderItem(item, itemIndex)}
          </div>
        );
      })}
    </div>
  );
}

export const MessageTimeline = forwardRef(MessageTimelineInner) as <Item>(
  props: MessageTimelineProps<Item> & RefAttributes<MessageTimelineHandle>,
) => ReactElement;
