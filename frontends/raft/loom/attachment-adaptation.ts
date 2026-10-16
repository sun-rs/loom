/** Checked native composition seams; upstream files remain byte-identical. */
function replace(source: string, from: string, to: string) {
  if (source.split(from).length !== 2)
    throw Error("Attachment composition boundary changed");
  return source.replace(from, to);
}
export function adaptAttachmentComposer(source: string) {
  return (
    'import { ComposerFilesTools } from "loom-composer-files";\n' +
    replace(
      source,
      "<div />\n            ) : (\n              <ComposerActions>",
      `<ComposerFilesTools taskMode={alsoCreateTask} insert={(text) => {
      const input = textareaRef.current;
      const start = input?.selectionStart ?? content.length;
      const end = input?.selectionEnd ?? start;
      const next = content.slice(0, start) + text + content.slice(end);
      contentRef.current = next;
      setContent(next);
      requestAnimationFrame(() => {
        input?.focus({preventScroll:true});
        input?.setSelectionRange(start + text.length, start + text.length);
        autoResize();
      });
    }} />
            ) : (
              <ComposerActions>`,
    )
  );
}
export function adaptAttachmentMessage(source: string) {
  let code = replace(
    source,
    "{/* Attached files */}",
    "{/* Attached files */}\n        {readOnlyProjection && <LoomAttachments attachments={message.attachments} parentMessage={message} />}",
  );
  code = replace(
    code,
    "{!forwardedBundleMetadata && message.attachments &&",
    "{!readOnlyProjection && !forwardedBundleMetadata && message.attachments &&",
  );
  return 'import LoomAttachments from "loom-attachments";\n' + code;
}
/** Retain the complete native panel renderer; replace only its Raft data owner. */
export function adaptAttachmentComments(source: string) {
  const start = source.indexOf(
    "  const currentUser = useAuthStore((s) => s.user);",
  );
  const end = source.indexOf("  // Fixed order (cindyz 6/11, task #28):");
  if (start < 0 || end <= start)
    throw Error("Official attachment comments boundary changed");
  let code =
    source.slice(0, start) +
    `  const { formatMessage } = useIntl();
  const { formatMessageTime } = useTimeFormatter();
  const { comments, pendingComments, error, listRef, activeAnchor, clearActiveAnchor, sendComment, controls, canComment, submitDisabled, writeBlockedCopy } = useLoomAttachmentComments({ attachmentId, parentMessage, pendingAnchor, getPendingAnchor, onAnchorCleared });
` +
    source.slice(end);
  code = replace(
    code,
    "<MessageInput\n              channelId=",
    "<MessageInput\n              submitDisabled={submitDisabled}\n              showTaskButton={false}\n              channelId=",
  );
  code = replace(
    code,
    "      <div ref={listRef}",
    "      {controls}\n      <div ref={listRef}",
  );
  return (
    'import { useAttachmentComments as useLoomAttachmentComments } from "loom-attachment-comments";\n' +
    code
  );
}
