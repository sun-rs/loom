import { useEffect, useRef, useState } from "react";
import type { Attachment } from "@rah-os/protocol";
import {
  classifyAttachmentPreview,
  MAX_ATTACHMENT_TEXT_PREVIEW_BYTES,
} from "@rah-os/protocol";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { loadPreviewImage } from "../file-preview-resource.ts";
import {
  FilePreview,
  useFilesClient,
  type AttachmentCommentContext,
} from "./room-files.tsx";

type Content = { text?: string; image?: string; error?: string };
export function MessageAttachmentCard({
  file,
  commentContext,
}: {
  file: Attachment;
  commentContext?: AttachmentCommentContext | undefined;
}) {
  const client = useFilesClient();
  const kind = classifyAttachmentPreview(file.mimeType, file.filename);
  const tileRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [thumbnail, setThumbnail] = useState<string>();
  const [content, setContent] = useState<Content>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [downloading, setDownloading] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  const downloadingRef = useRef(false);
  useEffect(() => {
    if (!tileRef.current || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(tileRef.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    if (
      visible &&
      kind === "image" &&
      file.size <= 20 * 1024 * 1024 &&
      client?.files
    )
      void loadPreviewImage(
        () => client.files!.download(file.attachmentId, controller.signal),
        file.mimeType,
        controller.signal,
      )
        .then((url) => {
          if (!controller.signal.aborted) setThumbnail(url);
        })
        .catch(() => {}); // A failed thumbnail retains the named, retryable preview card.
    return () => {
      controller.abort();
    };
  }, [client, file.attachmentId, file.mimeType, file.size, kind, visible]);
  async function preview() {
    if (request.current || loading) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(undefined);
    try {
      if (!client?.files) throw new Error("当前客户端不提供文件预览。");
      let loaded: Content | undefined;
      if (kind === "image")
        loaded = thumbnail ? { image: thumbnail } : undefined;
      else if (!["pdf", "audio", "video", "unsupported"].includes(kind)) {
        if (file.size > MAX_ATTACHMENT_TEXT_PREVIEW_BYTES)
          loaded = { error: "此文件不提供内嵌预览，请下载查看。" };
        else
          loaded = {
            text: await client.files.previewText(
              file.attachmentId,
              controller.signal,
            ),
          };
      }
      if (!controller.signal.aborted) {
        setContent(loaded);
        setOpen(true);
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "预览失败，请重试");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        request.current = undefined;
      }
    }
  }
  async function download() {
    if (!client?.files || downloadingRef.current) return;
    downloadingRef.current = true;
    setDownloading(true);
    setError(undefined);
    try {
      const blob = await client.files.download(file.attachmentId);
      const url = URL.createObjectURL(blob),
        link = document.createElement("a");
      link.href = url;
      link.download = file.filename.split(/[\\/]/).at(-1) || "file";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "下载失败，请重试");
    } finally {
      downloadingRef.current = false;
      setDownloading(false);
    }
  }
  const labels: Record<string, string> = {
    markdown: "Markdown 预览",
    html: "HTML 预览",
    text: "文本预览",
    csv: "表格预览",
    diff: "Diff 预览",
    image: "图片预览",
    pdf: "PDF 预览",
    video: "视频预览",
    audio: "音频预览",
  };
  const size =
    file.size < 1024
      ? `${file.size} B`
      : file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(1)} KB`
        : `${(file.size / 1024 / 1024).toFixed(1)} MB`;
  return (
    <div
      ref={tileRef}
      className={`rah-file-card rah-message-attachment${thumbnail ? " rah-message-image" : ""}`}
    >
      <button
        type="button"
        className="rah-file-open"
        aria-label={`预览 ${file.filename}`}
        aria-busy={loading}
        onClick={() => void preview()}
        title={file.filename}
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={file.filename}
            onLoad={(event) => {
              const image = event.currentTarget,
                scale = Math.min(
                  416 / image.naturalWidth,
                  288 / image.naturalHeight,
                  1,
                );
              const card = image.closest<HTMLElement>(".rah-message-image");
              if (card) {
                card.style.width = `min(${Math.round(image.naturalWidth * scale)}px, 100%)`;
                card.style.aspectRatio = `${image.naturalWidth}/${image.naturalHeight}`;
              }
            }}
          />
        ) : (
          <>
            <strong>{file.filename}</strong>
            <small>
              <span>{labels[kind] ?? file.mimeType}</span>
              <span>· {size}</span>
              {(file.commentCount ?? 0) > 0 &&
                !["image", "pdf"].includes(kind) && (
                  <span
                    className="rah-attachment-comment-count"
                    data-message-affordance="attachment-comment-count"
                    aria-label={`${file.commentCount} 条文件评论`}
                  >
                    <span aria-hidden="true">·</span>
                    <Icon name="chat" />
                    {file.commentCount}
                  </span>
                )}
            </small>
            <span className="rah-message-attachment-summary">
              {kind === "markdown" ? "Markdown 文档" : ""}
            </span>
            <Icon name="eye" />
          </>
        )}
        {loading && (
          <span className="rah-message-attachment-loading" role="status">
            <span className="rah-attachment-spinner" />
            正在打开预览…
          </span>
        )}
      </button>
      {error && !open && <p role="alert">{error}</p>}
      {open && (
        <FilePreview
          file={file}
          commentContext={commentContext}
          initialContent={content}
          downloadPending={downloading}
          downloadError={error}
          onClose={() => setOpen(false)}
          onDownload={() => void download()}
        />
      )}
    </div>
  );
}
