/** Retain frozen Raft source and its sole anchor owner. Only adapt full-window shifts. */
export function adaptTimelineWindow(source: string) {
  const replacements = [
    [
      "type ScrollAnchor = { messageId: string; offsetWithinScroller: number };",
      "type ScrollAnchor = { messageId: string; offsetWithinScroller: number; scrollTopAtCapture: number };",
    ],
    [
      "return { messageId: id, offsetWithinScroller };",
      "return { messageId: id, offsetWithinScroller, scrollTopAtCapture: scroller.scrollTop };",
    ],
    [
      "function restoreAnchor(scroller: HTMLElement, anchor: ScrollAnchor): boolean {",
      "function restoreAnchor(scroller: HTMLElement, anchor: ScrollAnchor, windowShift = false): boolean {",
    ],
    [
      "const delta = newOffset - anchor.offsetWithinScroller;",
      "const delta = newOffset - anchor.offsetWithinScroller + (windowShift ? anchor.scrollTopAtCapture - scroller.scrollTop : 0);",
    ],
  ];
  for (const [before, after] of replacements) {
    if (!source.includes(before!))
      throw Error("Official timeline anchor boundary changed");
    source = source.replace(before!, after!);
  }
  const branch = source.indexOf("} else if (firstChanged && lastChanged) {");
  const start = source.indexOf(
    "        const focusId = sourceRef.current.initialFocusMessageId;",
    branch,
  );
  const end = source.indexOf(
    "\n      }\n\n      prevFirstIdRef.current = firstId;",
    start,
  );
  if (
    branch < 0 ||
    start < 0 ||
    end < 0 ||
    !source
      .slice(start, end)
      .includes('focusedItem.scrollIntoView({ block: "center" });')
  )
    throw Error("Official timeline window boundary changed");
  return (
    source.slice(0, start) +
    `        const survivingAnchor = lastAnchorRef.current;
        if ((isFollowingBottomRef.current || armedFollowRef.current) && !sourceRef.current.hasNewer) {
          armedFollowRef.current = false;
          scrollToBottomImmediate(false);
        } else if (survivingAnchor && scroller.querySelector(timelineMessageItemSelector(survivingAnchor.messageId))) {
          // The physical edge of a truncated window is not the live tail.
          // ResizeObserver must keep this same anchor instead of following it.
          isFollowingBottomRef.current = false;
          armedFollowRef.current = false;
          beginProgrammaticScroll();
          restoreAnchor(scroller, survivingAnchor, true);
        } else {
${source.slice(start, end)}
        }` +
    source.slice(end)
  );
}
