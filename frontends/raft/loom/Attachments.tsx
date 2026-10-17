import {
  beginAttachmentPreview,
  cancelAttachmentPreview,
} from "./attachment-preview-request.ts";
import {
  classifyAttachmentPreview,
  MAX_ATTACHMENT_TEXT_PREVIEW_BYTES,
} from "@rah-os/protocol";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import { useDocumentPreviewStore } from "../packages/web/src/store/documentPreviewStore.ts";
import { useMediaPreviewStore } from "../packages/web/src/store/mediaPreviewStore.ts";
import { downloadLoomAttachment } from "./DocumentPreview.tsx";
import type { Message } from "../packages/web/src/store/messageStore.ts";
import { useState, useRef, useEffect } from "react";
import {
  MessageAttachmentGroup,
  MessageImageGallery,
  MessageImageGalleryRow,
  buildMessageImageGalleryRows,
} from "raft-ui";
import { GalleryImageItem } from "../packages/web/src/components/message/GalleryImageItem.tsx";
import { AttachmentChip } from "../packages/web/src/components/message/AttachmentChip.tsx";
import type { MessageAttachment } from "../packages/web/src/store/messageStore.ts";
import { HttpRahClient } from "@rah-os/client-sdk";
const client = new HttpRahClient({
  baseUrl: "",
  accessToken: () => "trusted-proxy-auth",
});
export default function Attachments({
  attachments,
  parentMessage,
}: {
  attachments?: MessageAttachment[];
  parentMessage?: Pick<Message, "id" | "channelId" | "senderId" | "senderType">;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState<string>();
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => cancelAttachmentPreview(pending.current), []);
  if (!attachments?.length) return null;
  const isImage = (a: MessageAttachment) =>
    /^image\/(png|jpeg|gif|webp|avif)$/.test(a.mimeType);
  const images = attachments.filter(isImage).map((a) => ({
    ...a,
    directUrl: "/v3/client/files/content/" + encodeURIComponent(a.id),
  }));
  const imageRows = buildMessageImageGalleryRows(images);
  const previewKind = (a: MessageAttachment) => {
    const kind = classifyAttachmentPreview(a.mimeType, a.filename);
    return a.sizeBytes <= MAX_ATTACHMENT_TEXT_PREVIEW_BYTES &&
      (kind === "text" || kind === "markdown" || kind === "html")
      ? kind
      : null;
  };
  async function open(a: MessageAttachment, preview = false) {
    if (hasUnresolvedIntents()) {
      setError("请先核实未决操作");
      return;
    }
    cancelAttachmentPreview(pending.current);
    const controller = preview
      ? beginAttachmentPreview()
      : new AbortController();
    pending.current = controller;
    setError("");
    setBusy(a.id);
    try {
      const kind = preview && previewKind(a);
      if (kind === "html") {
        useDocumentPreviewStore.getState().close();
        useMediaPreviewStore.getState().open({
          kind,
          attachment: a,
          url: new URL(
            "/v3/client/files/html-preview/" + encodeURIComponent(a.id),
            window.location.origin,
          ).href,
          ...(parentMessage ? { commentContext: { parentMessage } } : {}),
        });
      } else if (kind) {
        const text = await client.files.previewText(a.id, controller.signal);
        if (controller.signal.aborted) return;
        useMediaPreviewStore.getState().close();
        useDocumentPreviewStore.getState().open({
          attachment: a,
          preview:
            kind === "markdown"
              ? { kind, markdown: text }
              : { kind: "text", text },
          truncated: false,
          url: null,
          ...(parentMessage ? { commentContext: { parentMessage } } : {}),
        });
      } else await downloadLoomAttachment(a, controller.signal);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (pending.current === controller) setBusy(undefined);
    }
  }
  return (
    <div className="mt-1 space-y-2" data-testid="loom-message-attachments">
      {!!images.length && (
        <MessageImageGallery className="group-data-[followed-by]/message:mb-px">
          {imageRows.map((row) => (
            <MessageImageGalleryRow
              key={row.items.map((i) => images[i.index].id).join("-")}
              row={row}
            >
              {row.items.map((item) => {
                const image = images[item.index];
                return (
                  <GalleryImageItem
                    key={image.id}
                    att={image}
                    previewSrc={image.directUrl}
                    isOptimistic={false}
                    imageIndex={item.index}
                    lightboxImages={images}
                    layout={item}
                    onDownload={(a) => open(a)}
                  />
                );
              })}
            </MessageImageGalleryRow>
          ))}
        </MessageImageGallery>
      )}
      <MessageAttachmentGroup className="max-w-[22.5rem] group-data-[followed-by]/message:mb-px">
        {attachments
          .filter((a) => !isImage(a))
          .map((a) => (
            <AttachmentChip
              key={a.id}
              attachment={a}
              variant="compact"
              isOptimistic={false}
              loading={busy === a.id}
              loadingLabel="读取附件…"
              onClick={() => void open(a, true)}
              affordance={previewKind(a) ? "preview" : "download"}
              meta={<span>{a.sizeBytes} B</span>}
            />
          ))}
      </MessageAttachmentGroup>
      {error && (
        <p role="alert" className="text-xs text-warning-strong">
          {error}
        </p>
      )}
    </div>
  );
}
