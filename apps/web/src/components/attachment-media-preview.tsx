import { LoadingState } from "@rah-os/ui-web/neo-brutalist/loading-state";
import { lazy, Suspense, useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import {
  MAX_ATTACHMENT_MEDIA_PREVIEW_BYTES,
  type Attachment,
} from "@rah-os/protocol";
import { loadPreviewMedia } from "../file-preview-resource.ts";

const PdfAttachmentPreview = lazy(() => import("./pdf-attachment-preview.tsx"));

/** Raft native controls/sandbox, with authenticated bounded Blob transport. */
export function AttachmentMediaPreview({
  file,
  media,
  client,
}: {
  file: Attachment;
  media: { kind: "pdf" | "audio" | "video"; mimeType: string };
  client: RahClient | undefined;
}) {
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setUrl(undefined);
    setError(undefined);
    if (file.size > MAX_ATTACHMENT_MEDIA_PREVIEW_BYTES) {
      setError("此媒体超过 20 MiB 内嵌预览上限，请下载查看。");
    } else if (!client?.files) {
      setError("当前客户端不提供文件预览。");
    } else {
      void loadPreviewMedia(
        () => client.files!.download(file.attachmentId, controller.signal),
        file.size,
        media.mimeType,
        controller.signal,
      )
        .then((next) => {
          if (!controller.signal.aborted) setUrl(next);
        })
        .catch((e: Error) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }
    return () => controller.abort();
  }, [client, file.attachmentId, file.size, media.mimeType]);
  if (error) return <p role="alert">{error}</p>;
  if (!url) return <LoadingState />;
  const failed = () => setError("浏览器无法解码此文件，请下载查看。");
  if (media.kind === "pdf")
    return (
      <Suspense fallback={<LoadingState />}>
        <PdfAttachmentPreview url={url} filename={file.filename} />
      </Suspense>
    );
  return (
    <div className={`rah-media-preview rah-media-preview-${media.kind}`}>
      {media.kind === "video" ? (
        <video
          title={`视频 ${file.filename}`}
          src={url}
          controls
          playsInline
          preload="metadata"
          onError={failed}
        />
      ) : (
        <audio
          title={`音频 ${file.filename}`}
          src={url}
          controls
          preload="metadata"
          onError={failed}
        />
      )}
    </div>
  );
}
