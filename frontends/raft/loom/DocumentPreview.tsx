import { pageFetch } from "./page-fetch.ts";
import { AttachmentCommentsOwner } from "./useAttachmentComments.tsx";
import { DocumentAttachmentPreviewModal } from "../packages/web/src/components/message/attachmentPreviewSurfaces.tsx";
import { useDocumentPreviewStore } from "../packages/web/src/store/documentPreviewStore.ts";
import { HttpRahClient } from "@rah-os/client-sdk";
import { hasRouteBoundIntent } from "./useIntentRoute.ts";
import { showToast } from "../packages/web/src/components/toastBridge.ts";
import type { MessageAttachment } from "../packages/web/src/store/messageStore.ts";
const client = new HttpRahClient({
  fetch: pageFetch,
  baseUrl: "",
  accessToken: () => "trusted-proxy-auth",
});
export async function downloadLoomAttachment(
  a: MessageAttachment,
  signal?: AbortSignal,
) {
  const blob = await client.files.download(a.id, signal);
  if (signal?.aborted) return;
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = a.filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Native app-level presentation store and full preview surface; Loom transport only. */
export default function DocumentPreview() {
  const entry = useDocumentPreviewStore((s) => s.entry);
  if (!entry) return null;
  const content = (
    <DocumentAttachmentPreviewModal
      key={entry.attachment.id}
      filename={entry.attachment.filename}
      preview={entry.preview}
      truncated={entry.truncated}
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
        if (!hasRouteBoundIntent()) useDocumentPreviewStore.getState().close();
      }}
      onDownload={() =>
        void downloadLoomAttachment(entry.attachment).catch(() =>
          showToast({ title: "无法下载附件，请重试", type: "error" }),
        )
      }
      onCopyError={() =>
        showToast({ title: "无法复制，请重试", type: "error" })
      }
    />
  );
  return entry.commentContext ? (
    <AttachmentCommentsOwner
      key={entry.attachment.id}
      attachmentId={entry.attachment.id}
      wholeFileOnly={entry.preview.kind === "pdf"}
      parentMessage={entry.commentContext.parentMessage}
    >
      {content}
    </AttachmentCommentsOwner>
  ) : (
    content
  );
}
