import { AttachmentCommentsOwner } from "./useAttachmentComments.tsx";
import { HtmlAttachmentPreviewModal } from "../packages/web/src/components/message/attachmentPreviewSurfaces.tsx";
import { useMediaPreviewStore } from "../packages/web/src/store/mediaPreviewStore.ts";
import { hasRouteBoundIntent } from "./useIntentRoute.ts";
import { showToast } from "../packages/web/src/components/toastBridge.ts";
import { downloadLoomAttachment } from "./DocumentPreview.tsx";
/** Official HTML surface and presentation store; Loom owns access and comments. */
export default function HtmlPreview() {
  const entry = useMediaPreviewStore((s) => s.entry);
  if (!entry || entry.kind !== "html") return null;
  const content = (
    <HtmlAttachmentPreviewModal
      key={entry.attachment.id}
      filename={entry.attachment.filename}
      url={entry.url}
      comments={
        entry.commentContext
          ? {
              attachmentId: entry.attachment.id,
              filename: entry.attachment.filename,
              commentCount: entry.attachment.commentCount ?? 0,
              parentMessage: entry.commentContext.parentMessage,
            }
          : undefined
      }
      onClose={() => {
        if (!hasRouteBoundIntent()) useMediaPreviewStore.getState().close();
      }}
      onDownload={() =>
        void downloadLoomAttachment(entry.attachment).catch(() =>
          showToast({ title: "无法下载附件，请重试", type: "error" }),
        )
      }
    />
  );
  return entry.commentContext ? (
    <AttachmentCommentsOwner
      key={entry.attachment.id}
      attachmentId={entry.attachment.id}
      parentMessage={entry.commentContext.parentMessage}
    >
      {content}
    </AttachmentCommentsOwner>
  ) : (
    content
  );
}
