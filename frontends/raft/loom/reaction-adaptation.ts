function replace(source: string, from: string, to: string) {
  if (source.split(from).length !== 2)
    throw Error("Official reaction boundary changed");
  return source.replace(from, to);
}
/** Apply after existing task/thread adapters. Keep native picker, chips and gestures. */
export function adaptReactions(source: string) {
  let code = replace(
    source,
    "  const loomTaskActions =",
    "  const loomReactions = useLoomReactions(message);\n  if (readOnlyProjection) canReact = !!loomReactions?.canReact;\n  const loomTaskActions =",
  );
  code = replace(
    code,
    "const reactions = useMemo(() => message.reactions ?? [], [message.reactions]);",
    "const reactions = useMemo(() => loomReactions?.reactions ?? message.reactions ?? [], [loomReactions, message.reactions]);",
  );
  code = replace(
    code,
    "const hasCurrentUserReaction = useCallback((emoji: string) => {",
    "const hasCurrentUserReaction = useCallback((emoji: string) => {\n    if (loomReactions) return loomReactions.mine(emoji);",
  );
  code = replace(
    code,
    "  }, [\n    reactions,\n    viewerUserId,",
    "  }, [\n    loomReactions,\n    reactions,\n    viewerUserId,",
  );
  code = replace(
    code,
    "const handleToggleReaction = useCallback(async (emoji: string) => {",
    "const handleToggleReaction = useCallback(async (emoji: string) => {\n    if (readOnlyProjection) { loomReactions?.toggle(emoji); return; }",
  );
  code = replace(
    code,
    "    hasCurrentUserReaction,\n    isSystem,",
    "    hasCurrentUserReaction,\n    loomReactions,\n    readOnlyProjection,\n    isSystem,",
  );
  code = code.replaceAll(
    "readOnlyProjection && !loomTaskActions ? undefined",
    "readOnlyProjection && !loomTaskActions && !loomReactions?.canReact && !loomReactions?.canSave ? undefined",
  );
  code = replace(
    code,
    "onOpenThread && !hideThreadActions ? <LoomThreadToolbar onReplyInThread={handleReplyInThread} /> : null",
    "(onOpenThread && !hideThreadActions) || canReact || loomReactions?.canSave ? <MessageHoverToolbar isSaved={!!loomReactions?.saved} loomHideSave={!loomReactions?.canSave} reactionActive={!!reactionPicker} hideThreadActions={!onOpenThread || hideThreadActions} isSystem={isSystem} canReact={canReact} onReplyInThread={handleReplyInThread} onReactionClick={handleReactionClick} onToggleSave={(event) => {event.stopPropagation(); loomReactions?.toggleSave();}} /> : null",
  );
  code = replace(
    code,
    "const handleToggleSave = useCallback(() => {",
    "const handleToggleSave = useCallback(() => {\n    if(readOnlyProjection) {loomReactions?.toggleSave(); return;}",
  );
  code = replace(
    code,
    "}, [isSaved, message.id]);",
    "}, [isSaved, message.id, readOnlyProjection, loomReactions]);",
  );
  const start = code.indexOf("          {/* Reaction quick row");
  const end = code.indexOf(
    "          <MenuItem\n            icon={<Link",
    start,
  );
  if (start < 0 || end < start)
    throw Error("Official reaction quick row changed");
  const quick = code.slice(start, end);
  code = replace(
    code,
    "<LoomTaskMenu actions={loomTaskActions} close={handleCloseCtx} />",
    `<>${quick}{loomReactions?.canSave && <MenuItem icon={loomReactions.saved ? <BookmarkMinus size={14} /> : <Bookmark size={14} />} onClick={() => {loomReactions.toggleSave(); handleCloseCtx();}}>{loomReactions.saved ? formatMessage({id:"message.messageItem.removeFromSaved"}) : formatMessage({id:"message.messageItem.saveMessage"})}</MenuItem>}<LoomTaskMenu actions={loomTaskActions} close={handleCloseCtx} /></>`,
  );
  code = replace(
    code,
    "const isSaved = useSavedStore((s) => s.savedIds.has(message.id));",
    "const legacySaved = useSavedStore((s) => s.savedIds.has(message.id)); const isSaved = readOnlyProjection ? !!loomReactions?.saved : legacySaved;",
  );
  return 'import {useLoomReactions} from "loom-reactions";\n' + code;
}
