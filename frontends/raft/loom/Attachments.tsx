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
}: {
  attachments?: MessageAttachment[];
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState<string>();
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  if (!attachments?.length) return null;
  const isImage = (a: MessageAttachment) =>
    /^image\/(png|jpeg|gif|webp|avif)$/.test(a.mimeType);
  const images = attachments.filter(isImage).map((a) => ({
    ...a,
    directUrl: "/v3/client/files/content/" + encodeURIComponent(a.id),
  }));
  const imageRows = buildMessageImageGalleryRows(images);
  async function open(a: MessageAttachment) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setError("");
    setBusy(a.id);
    try {
      const blob = await client.files.download(a.id, controller.signal);
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = a.filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!controller.signal.aborted) setBusy(undefined);
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
                    onDownload={open}
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
              onClick={() => void open(a)}
              affordance="download"
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
