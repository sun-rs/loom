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
    "{/* Attached files */}\n        {readOnlyProjection && <LoomAttachments attachments={message.attachments} />}",
  );
  code = replace(
    code,
    "{!forwardedBundleMetadata && message.attachments &&",
    "{!readOnlyProjection && !forwardedBundleMetadata && message.attachments &&",
  );
  return 'import LoomAttachments from "loom-attachments";\n' + code;
}
