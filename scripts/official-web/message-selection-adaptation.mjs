// Narrow compatibility slots for the acquired Web1.21.38 selection Drawer.
export function adaptMessageTextSelection(source) {
  function replace(a, b) {
    if (source.split(a).length !== 2)
      throw Error("Message selection seam changed: " + a);
    source = source.replace(a, b);
  }
  replace(
    "  const time = formatMessageTime(message.createdAt);",
    `  const [loomSelectText, setLoomSelectText] = useState<"open" | "closing" | null>(null);
  const time = formatMessageTime(message.createdAt);`,
  );
  // Web1.21.38 moves touch text selection into its Drawer. Keep native external-link ownership,
  // and route the browser's long-press context event through the same touch placement.
  replace(
    "  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);\n  const longPressFired = useRef(false);",
    "",
  );
  replace(
    "  const handleContextMenu = useCallback((e: MouseEvent) => {",
    `  const loomTouchPoint = useRef<{x:number;y:number} | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  // Structural binding of Web1.21.38 Di: both native contextmenu and the timer
  // enter the same touch placement/click-shield owner, exactly once.
  const openTouchMessageMenu = useCallback((point: {x:number;y:number}) => {
    if (longPressTimer.current) {clearTimeout(longPressTimer.current); longPressTimer.current=null;}
    longPressFired.current=true;
    setCtxMenu(placeTouchMessageContextMenu(point));
    setReactionPicker(null);
    setCtxMenuClickShielded(true);
    if (ctxMenuShieldTimerRef.current) clearTimeout(ctxMenuShieldTimerRef.current);
    ctxMenuShieldTimerRef.current=setTimeout(() => {setCtxMenuClickShielded(false);ctxMenuShieldTimerRef.current=null;},600);
  }, []);
  const handleContextMenu = useCallback((e: MouseEvent) => {`,
  );
  replace(
    "    if (target.closest(\"[data-message-selectable='true']\")) return;",
    "    if (target.closest('a[target=\"_blank\"]')) return;",
  );
  replace(
    "    const y = touch.clientY;\n    longPressTimer.current",
    "    const y = touch.clientY;\n    loomTouchPoint.current = {x,y};\n    longPressTimer.current",
  );
  replace(
    "    const keyboardAnchor =",
    "    if (loomTouchPoint.current) { if (!longPressFired.current) openTouchMessageMenu(loomTouchPoint.current); return; }\n    const keyboardAnchor =",
  );
  replace(
    "  const handleTouchEnd = useCallback((e: TouchEvent) => {",
    "  const handleTouchEnd = useCallback((e: TouchEvent) => {\n    loomTouchPoint.current = null;",
  );
  replace(
    "  const handleTouchMove = useCallback(() => {",
    "  const handleTouchMove = useCallback(() => {\n    loomTouchPoint.current = null;",
  );
  replace(
    "      onTouchEnd={readOnlyProjection",
    "      onTouchCancel={handleTouchMove}\n      onTouchEnd={readOnlyProjection",
  );
  const timerStart = source.indexOf(
    "    longPressTimer.current = setTimeout(() => {",
  );
  const timerEnd = source.indexOf("    }, 500);", timerStart);
  if (timerStart < 0 || timerEnd < timerStart)
    throw Error("Official touch timer changed");
  source =
    source.slice(0, timerStart) +
    "    longPressTimer.current = setTimeout(() => openTouchMessageMenu({x,y}), 500);" +
    source.slice(timerEnd + "    }, 500);".length);
  source = source.replaceAll(
    "}, [isSystem, selectionActive]);",
    "}, [isSystem, selectionActive, openTouchMessageMenu]);",
  );
  const action = `{ctxMenu.source === "touch" && message.content.trim() && <MenuItem icon={<TextSelect width={14} height={14}/>} onClick={() => { setLoomSelectText("open"); handleCloseCtx(); }}>选择文本</MenuItem>}`;
  replace(
    "<LoomTaskMenu actions={loomTaskActions} close={handleCloseCtx} />",
    "<LoomTaskMenu actions={loomTaskActions} close={handleCloseCtx} />" +
      action,
  );
  replace(
    '{formatMessage({ id: "message.messageItem.copyMarkdown" })}\n          </MenuItem>',
    '{formatMessage({ id: "message.messageItem.copyMarkdown" })}\n          </MenuItem>' +
      action,
  );
  replace(
    "    {senderCtxMenu && createPortal(",
    `    {loomSelectText && <OfficialMessageSelectText open={loomSelectText === "open"} onClose={() => setLoomSelectText("closing")} onClosed={() => setLoomSelectText(null)} senderName={senderDisplayName} time={time} markdown={message.content} quoteChannelId={quoteComposerChannelId}/>}
    {senderCtxMenu && createPortal(`,
  );
  return (
    'import OfficialMessageSelectText from "loom-message-select-text";\nimport {TextSelect} from "lucide-react";\n' +
    source
  );
}
