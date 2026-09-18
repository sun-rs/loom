import { MessageAttachmentCard } from "./message-attachment-card.tsx";
import { AttachmentComments } from "./attachment-comments.tsx";
import {
  attachmentAnchorAt,
  jumpToAttachmentAnchor,
  type AttachmentAnchor,
} from "../attachment-comment-anchors.ts";
import { AttachmentMediaPreview } from "./attachment-media-preview.tsx";
import { ActionMenu } from "@rah-os/ui-web/neo-brutalist/action-menu";
import { EmptyState } from "@rah-os/ui-web/neo-brutalist/empty-state";
import { loadPreviewImage } from "../file-preview-resource.ts";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { RahClient } from "@rah-os/client-sdk";
import {
  MAX_ATTACHMENT_TEXT_PREVIEW_BYTES,
  classifyAttachmentPreview,
  attachmentMediaPreview,
  type Attachment,
  type RoomFile,
} from "@rah-os/protocol";
import { FileUploadStore } from "../file-uploads.ts";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { useReconciledQuery } from "../use-reconciled-query.ts";
import { ComposerAttachmentPickers } from "@rah-os/ui-web/neo-brutalist/composer-attachment-pickers";
import { ComposerComputerFiles } from "./composer-computer-files.tsx";
import { useMobileLayout } from "../use-mobile-layout.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { FileGlyph } from "./file-glyph.tsx";
import { AttachmentTextPreview } from "./file-preview-renderers.tsx";
import { formatRahDateTime } from "../date-time-presentation.ts";

const FilesContext = createContext<{
  client: RahClient;
  uploads: FileUploadStore;
} | null>(null);
export const useFilesClient = () => useContext(FilesContext)?.client;
export function FilesProvider({
  client,
  children,
}: {
  client: RahClient;
  children: ReactNode;
}) {
  const [uploads] = useState(() => new FileUploadStore(client));
  useEffect(() => () => uploads.dispose(), [uploads]);
  return (
    <FilesContext.Provider value={{ client, uploads }}>
      {children}
    </FilesContext.Provider>
  );
}
export function useRoomUploads(roomId?: string, draftKey = roomId) {
  const context = useContext(FilesContext);
  const rows = useSyncExternalStore(
    context?.uploads.subscribe ?? noopSubscribe,
    () => context?.uploads.read(draftKey) ?? emptyUploads,
  );
  return {
    draftKey,
    rows,
    store: context?.uploads,
    enabled: !!context?.client.files,
  };
}
const emptyUploads = Object.freeze([]);
const noopSubscribe = () => () => {};
export function ComposerFiles({
  roomId,
  conversationLabel,
  draftKey,
  disabled,
  onReference,
  uploadsDisabled = disabled,
}: {
  roomId: string | undefined;
  conversationLabel: string;
  draftKey?: string | undefined;
  disabled: boolean;
  onReference: (paths: string[]) => void;
  uploadsDisabled?: boolean;
}) {
  const uploads = useRoomUploads(roomId, draftKey);
  const { rows, store, enabled } = uploads;
  const [error, setError] = useState<string>();
  const client = useFilesClient();
  const mobile = useMobileLayout();
  const [browserOpen, setBrowserOpen] = useState(false);
  return (
    <div className="rah-composer-files">
      <ComposerAttachmentPickers
        disabled={disabled || !roomId}
        uploadsDisabled={uploadsDisabled || !enabled || !roomId}
        mobile={mobile}
        onComputer={() => setBrowserOpen(true)}
        browser={
          browserOpen && client ? (
            <ComposerComputerFiles
              client={client}
              conversationLabel={conversationLabel}
              onClose={() => setBrowserOpen(false)}
              onSelect={onReference}
            />
          ) : null
        }
        onFiles={(files) => {
          setError(undefined);
          if (!uploadsDisabled && enabled && roomId && store)
            for (const file of files)
              void store
                .add(uploads.draftKey ?? roomId, roomId, file)
                .catch((e: Error) => setError(e.message));
        }}
      />
      {rows.map((row) => (
        <span className="rah-file-draft" key={row.id}>
          <span title={row.file.name}>{row.file.name}</span>
          <small>
            {row.status === "ready"
              ? "已上传"
              : row.status === "uploading"
                ? "上传中…"
                : (row.error ?? "上传失败")}
          </small>
          <button
            type="button"
            aria-label={`移除附件 ${row.file.name}`}
            disabled={disabled}
            onClick={() =>
              uploads.draftKey && store?.remove(uploads.draftKey, row.id)
            }
          >
            ×
          </button>
        </span>
      ))}
      {error && <span role="alert">{error}</span>}
    </div>
  );
}
function bytesLabel(size: number) {
  return size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;
}
export type AttachmentCommentContext = { parentMessageId: string };

export function MessageAttachments({
  attachments,
  commentCounts,
  commentContext,
}: {
  attachments?: readonly Attachment[] | undefined;
  commentCounts?: Record<string, number> | undefined;
  commentContext?: AttachmentCommentContext | undefined;
}) {
  return attachments?.length ? (
    <div className="rah-message-files">
      {attachments.map((file) => (
        <MessageAttachmentCard
          key={file.attachmentId}
          file={
            commentCounts
              ? {
                  ...file,
                  commentCount:
                    commentCounts[file.attachmentId] ?? file.commentCount,
                }
              : file
          }
          commentContext={commentContext}
        />
      ))}
    </div>
  ) : null;
}
function FileCard({
  file,
  commentContext,
  onSource,
}: {
  file: Attachment | RoomFile;
  commentContext?: AttachmentCommentContext | undefined;
  onSource?: (() => void) | undefined;
}) {
  const context = useContext(FilesContext);
  const [preview, setPreview] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState(false);
  const downloadActive = useRef(false);
  const [error, setError] = useState<string>();
  async function download() {
    if (downloadActive.current) return;
    downloadActive.current = true;
    setMenu(false);
    setPending(true);
    setError(undefined);
    try {
      if (!context?.client.files) throw new Error("附件下载不可用");
      const blob = await context.client.files.download(file.attachmentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename.split(/[\\/]/).at(-1) || "file";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      downloadActive.current = false;
      setPending(false);
    }
  }
  return (
    <div className={"rah-file-card" + (onSource ? " has-source" : "")}>
      <button
        type="button"
        className="rah-file-open"
        onClick={() => setPreview(true)}
        title="预览文件"
      >
        <span className="rah-file-icon">
          <FileGlyph kind="file" />
        </span>
        <span className="rah-file-label">
          <strong>{file.filename}</strong>
          <small>
            {bytesLabel(file.size)}
            {"createdAt" in file && (
              <span className="rah-file-date">
                <svg
                  aria-hidden="true"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 6v6h4" />
                </svg>
                {formatRahDateTime(file.createdAt, {
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            )}
          </small>
        </span>
      </button>
      {onSource && (
        <button
          type="button"
          className="sq-btn rah-file-direct-action rah-file-source"
          aria-label={"跳转到 " + file.filename + " 的原消息"}
          title="跳转到原消息"
          onClick={onSource}
        >
          <Icon name="map-pin" />
        </button>
      )}
      {onSource && (
        <button
          type="button"
          className="sq-btn rah-file-direct-action rah-file-download"
          aria-label={"下载 " + file.filename}
          title="下载文件"
          onClick={() => void download()}
          disabled={pending}
        >
          <Icon name="download" />
        </button>
      )}
      <ActionMenu
        open={menu}
        onOpenChange={setMenu}
        label={`${file.filename} 的操作`}
        className="rah-file-menu"
        trigger={
          <button
            type="button"
            className="sq-btn rah-file-overflow"
            aria-label={`${file.filename} 的操作`}
            disabled={pending}
          >
            <FileGlyph kind="more" />
          </button>
        }
        items={[
          ...(onSource
            ? [{ key: "source", label: "跳转到原消息", onSelect: onSource }]
            : []),
          {
            key: "download",
            label: "下载文件",
            disabled: pending,
            onSelect: () => void download(),
          },
        ]}
      />
      {error && !preview && <span role="alert">{error}</span>}
      {preview && (
        <FilePreview
          file={file}
          commentContext={commentContext}
          downloadPending={pending}
          downloadError={error}
          onClose={() => setPreview(false)}
          onDownload={() => void download()}
        />
      )}
    </div>
  );
}
export function FilePreview({
  initialContent,
  file,
  commentContext,
  downloadPending,
  downloadError,
  onClose,
  onDownload,
}: {
  initialContent?:
    { text?: string; image?: string; error?: string } | undefined;
  file: Attachment;
  commentContext: AttachmentCommentContext | undefined;
  downloadPending: boolean;
  downloadError: string | undefined;
  onClose: () => void;
  onDownload: () => void;
}) {
  const context = useContext(FilesContext);
  const kind = classifyAttachmentPreview(file.mimeType, file.filename);
  // Raft RYe/SYe/EYe: entry context enables comments; PDF and audio omit it.
  // The existing file-comments service still resolves authority and the source Room.
  const commentsEnabled =
    !!commentContext && kind !== "pdf" && kind !== "audio";
  const [content, setContent] = useState<
    | {
        text?: string;
        image?: string;
        error?: string;
      }
    | undefined
  >(initialContent);
  const dialogRef = useDialogProtocol({ blocked: false, onClose });
  const previewRef = useRef<HTMLDivElement>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<AttachmentAnchor>();
  const [videoTime, setVideoTime] = useState<number>();
  function selectAnchor(node: Node | null) {
    if (!commentsEnabled || !previewRef.current) return;
    const selection = window.getSelection();
    let anchor = attachmentAnchorAt(previewRef.current, node, kind);
    if (selection && !selection.isCollapsed && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      const start = attachmentAnchorAt(
        previewRef.current,
        range.startContainer,
        kind,
      );
      const end = attachmentAnchorAt(
        previewRef.current,
        range.endContainer,
        kind,
      );
      if (start && end && start.type === end.type) {
        anchor = {
          ...start,
          data: { ...start.data, quote: selection.toString().slice(0, 1000) },
        };
        if (
          typeof start.data.start === "number" &&
          typeof end.data.end === "number"
        )
          anchor.data.end = end.data.end;
      }
    }
    if (anchor) {
      setPendingAnchor(anchor);
      setCommentsOpen(true);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    if (initialContent) return () => controller.abort();
    if (attachmentMediaPreview(file.mimeType, file.filename))
      return () => controller.abort();
    const raster = kind === "image";
    if (
      kind === "unsupported" ||
      file.size >
        (raster ? 20 * 1024 * 1024 : MAX_ATTACHMENT_TEXT_PREVIEW_BYTES)
    ) {
      setContent({ error: "此文件不提供内嵌预览，请下载查看。" });
      return () => controller.abort();
    }
    if (!context?.client.files) {
      setContent({ error: "当前客户端不提供文件预览。" });
      return () => controller.abort();
    }
    const load = raster
      ? loadPreviewImage(
          () =>
            context.client.files!.download(
              file.attachmentId,
              controller.signal,
            ),
          file.mimeType,
          controller.signal,
        ).then((image) => ({ image }))
      : context.client.files
          .previewText(file.attachmentId, controller.signal)
          .then((text) => ({ text }));
    void load
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setContent(loaded);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setContent({ error: e.message });
      });
    return () => {
      controller.abort();
    };
  }, [context?.client, file, kind, initialContent]);
  // Message rows own layout containment; modal geometry must belong to the viewport.
  return createPortal(
    <div className="rah-dialog-layer">
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭文件预览"
        onClick={onClose}
      />
      <section
        className="rah-dialog rah-file-preview"
        data-preview-kind={kind}
        role="dialog"
        aria-modal="true"
        aria-label={`预览 ${file.filename}`}
        tabIndex={-1}
        ref={dialogRef}
      >
        <header>
          <h2>{file.filename}</h2>
          {commentsEnabled && (
            <button
              type="button"
              aria-expanded={commentsOpen}
              aria-label="评论"
              className={"sq-btn" + (commentsOpen ? " is-active" : "")}
              onClick={() => setCommentsOpen((value) => !value)}
            >
              <Icon name="message-square-more" />
            </button>
          )}
          {commentsEnabled && videoTime !== undefined && (
            <button
              type="button"
              onClick={() => {
                setPendingAnchor({
                  type: "video-timestamp",
                  data: { time: videoTime },
                });
                setCommentsOpen(true);
              }}
            >
              评论当前时间
            </button>
          )}
          <button
            type="button"
            className="sq-btn"
            aria-label={downloadPending ? "下载中…" : "下载"}
            onClick={onDownload}
            disabled={downloadPending}
          >
            <Icon name="download" />
          </button>
          <button
            type="button"
            className="sq-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="rah-file-preview-columns">
          <div
            className="rah-file-preview-body"
            ref={previewRef}
            data-anchor-scope="attachment"
            onMouseUp={(event) => {
              if (
                !(event.target instanceof Element) ||
                !event.target.closest("a, button, input, video, audio")
              )
                selectAnchor(event.target as Node);
            }}
            onTimeUpdate={(event) => {
              const media = event.target;
              if (media instanceof HTMLVideoElement)
                setVideoTime(
                  media.paused && media.currentTime > 0
                    ? Math.round(media.currentTime * 1000) / 1000
                    : undefined,
                );
            }}
            onPause={(event) => {
              const media = event.target;
              if (media instanceof HTMLVideoElement)
                setVideoTime(
                  media.currentTime > 0
                    ? Math.round(media.currentTime * 1000) / 1000
                    : undefined,
                );
            }}
            onPlay={() => setVideoTime(undefined)}
          >
            {downloadError && <p role="alert">{downloadError}</p>}
            {attachmentMediaPreview(file.mimeType, file.filename) ? (
              <AttachmentMediaPreview
                file={file}
                media={attachmentMediaPreview(file.mimeType, file.filename)!}
                client={context?.client}
              />
            ) : !content ? (
              <p>正在加载…</p>
            ) : content.image ? (
              <img alt={file.filename} src={content.image} />
            ) : content.text !== undefined ? (
              kind === "image" ||
              kind === "unsupported" ||
              kind === "pdf" ||
              kind === "audio" ||
              kind === "video" ? (
                <p>此文件不提供内嵌预览，请下载查看。</p>
              ) : (
                <AttachmentTextPreview
                  filename={file.filename}
                  kind={kind}
                  text={content.text}
                  commentMode={commentsOpen}
                  onAnchor={setPendingAnchor}
                />
              )
            ) : (
              <p>{content.error}</p>
            )}
          </div>
          {context && commentsEnabled && (
            <AttachmentComments
              key={file.attachmentId}
              client={context.client}
              attachmentId={file.attachmentId}
              filename={file.filename}
              kind={kind}
              open={commentsOpen}
              pendingAnchor={pendingAnchor}
              onClearAnchor={() => setPendingAnchor(undefined)}
              onToggle={() => setCommentsOpen((value) => !value)}
              onJump={(anchor) => {
                const jumped =
                  !!previewRef.current &&
                  jumpToAttachmentAnchor(previewRef.current, anchor, kind);
                if (jumped && window.matchMedia("(max-width: 767px)").matches) {
                  setCommentsOpen(false);
                  setPendingAnchor(undefined);
                }
                return jumped;
              }}
            />
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
export function RoomFilesPane({
  roomId,
  onSource,
}: {
  roomId: string | undefined;
  onSource: (file: RoomFile) => void;
}) {
  const context = useContext(FilesContext);
  const [files, setFiles] = useState<RoomFile[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setFiles([]);
    setCursor(undefined);
    setPending(true);
    setError(undefined);
    if (!context || !roomId) {
      setPending(false);
      return;
    }
    void context.client
      .request("file.list", { roomId }, { signal: controller.signal })
      .then((result) => {
        if (generation.current === current) {
          setFiles(result.files);
          setCursor(result.nextCursor);
        }
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (generation.current === current) setPending(false);
      });
    return () => {
      ++generation.current;
      controller.abort();
    };
  }, [context?.client, roomId, revision]);
  async function more() {
    if (!context || !roomId || !cursor || pending) return;
    const current = generation.current;
    setPending(true);
    try {
      const result = await context.client.request("file.list", {
        roomId,
        cursor,
      });
      if (current === generation.current) {
        setFiles((rows) => [...rows, ...result.files]);
        setCursor(result.nextCursor);
      }
    } catch (e) {
      if (current === generation.current) setError(String(e));
    } finally {
      if (current === generation.current) setPending(false);
    }
  }
  return (
    <section
      className="rah-room-files rah-scroll-main"
      aria-label="当前对话文件"
    >
      <div className="rah-file-list">
        {files.map((file) => (
          <FileCard
            key={file.attachmentId}
            file={file}
            onSource={() => onSource(file)}
          />
        ))}
        {error ? (
          <p role="alert">
            {error}{" "}
            <button onClick={() => setRevision((v) => v + 1)}>重试</button>
          </p>
        ) : !pending && !files.length ? (
          <EmptyState
            context="file"
            placement="fill"
            icon="clip"
            title="暂无文件"
            description="在聊天中添加附件，或将文件拖入消息编辑框。消息发送后文件会显示在这里。"
          />
        ) : null}
        {pending ? (
          <p role="status">正在加载文件…</p>
        ) : cursor ? (
          <button onClick={() => void more()}>加载更多文件</button>
        ) : null}
      </div>
    </section>
  );
}
