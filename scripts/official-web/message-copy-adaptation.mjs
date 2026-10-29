export function adaptMessageCopy(source) {
  const replace = (a, b) => {
    if (source.split(a).length !== 2)
      throw Error("Message copy binding changed: " + a);
    source = source.replace(a, b);
  };
  replace(
    "  const quoteComposerChannelId = useMemo(() => {",
    "  const quoteComposerChannelId = useMemo(() => {\n    if (mentionComposerChannelId) return mentionComposerChannelId;",
  );
  replace(
    "  }, [parentMessageId, hideThreadActions, message.threadId, parentChannelId, message.channelId]);",
    "  }, [mentionComposerChannelId, parentMessageId, hideThreadActions, message.threadId, parentChannelId, message.channelId]);",
  );
  replace(
    "{loomReactions?.canSave && <MenuItem",
    "<LoomMessageCopyItems roomId={parentChannelId || message.channelId} messageId={message.id} rootMessageId={parentMessageId} markdown={message.content} close={handleCloseCtx}/><ContextMenuDivider/>{loomReactions?.canSave && <MenuItem",
  );
  return 'import LoomMessageCopyItems from "loom-message-copy";\n' + source;
}
