import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
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
  type Attachment,
  type RoomFile,
} from "@rah-os/protocol";
import { FileUploadStore } from "../file-uploads.ts";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { FileGlyph } from "./file-glyph.tsx";
import { AttachmentTextPreview } from "./file-preview-renderers.tsx";
import { formatRahDateTime } from "../date-time-presentation.ts";

const FilesContext = createContext<{
  client: RahClient;
  uploads: FileUploadStore;
} | null>(null);
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
  draftKey,
  disabled,
}: {
  roomId: string | undefined;
  draftKey?: string | undefined;
  disabled: boolean;
}) {
  const uploads = useRoomUploads(roomId, draftKey);
  const { rows, store, enabled } = uploads;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();
  return (
    <div className="rah-composer-files">
      <input
        ref={inputRef}
        type="file"
        aria-label="选择附件"
        multiple
        hidden
        onChange={(event) => {
          if (roomId && store)
            for (const file of event.target.files ?? [])
              void store
                .add(uploads.draftKey ?? roomId, roomId, file)
                .catch((e: Error) => setError(e.message));
          event.target.value = "";
        }}
      />
      <button
        className="sq-btn"
        type="button"
        aria-label="添加附件"
        title="添加附件"
        disabled={disabled || !enabled || !roomId}
        onClick={() => {
          setError(undefined);
          inputRef.current?.click();
        }}
      >
        <Icon name="clip" />
      </button>
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
export function MessageAttachments({
  attachments,
}: {
  attachments?: readonly Attachment[] | undefined;
}) {
  return attachments?.length ? (
    <div className="rah-message-files">
      {attachments.map((file) => (
        <FileCard key={file.attachmentId} file={file} />
      ))}
    </div>
  ) : null;
}
function FileCard({
  file,
  onSource,
}: {
  file: Attachment | RoomFile;
  onSource?: (() => void) | undefined;
}) {
  const context = useContext(FilesContext);
  const [preview, setPreview] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Same portal/flip protocol as the existing Raft-derived DiscoveryFilter.
  useLayoutEffect(() => {
    if (!menu) return;
    const place = () => {
      if (!trigger.current || !menuRef.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const popup = menuRef.current.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(anchor.right - popup.width, innerWidth - popup.width - 8),
      );
      const top =
        anchor.bottom + popup.height + 4 < innerHeight - 8
          ? anchor.bottom + 4
          : Math.max(8, anchor.top - popup.height - 4);
      Object.assign(menuRef.current.style, {
        left: `${left}px`,
        top: `${top}px`,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const closeOutside = (e: PointerEvent) => {
      if (
        !root.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      )
        setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(false);
        trigger.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const rows = [
          ...(menuRef.current?.querySelectorAll<HTMLElement>(
            '[role="menuitem"]',
          ) ?? []),
        ];
        if (!rows.length) return;
        e.preventDefault();
        const index = rows.indexOf(document.activeElement as HTMLElement);
        rows[
          (index + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length
        ]?.focus();
      }
    };
    window.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", key);
    };
  }, [menu]);
  async function download() {
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
      setPending(false);
    }
  }
  return (
    <div
      className={"rah-file-card" + (onSource ? " has-source" : "")}
      ref={root}
    >
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
          <Icon name="message-square" />
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
      <button
        ref={trigger}
        type="button"
        className="sq-btn rah-file-overflow"
        aria-label={`${file.filename} 的操作`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((v) => !v)}
        disabled={pending}
      >
        <FileGlyph kind="more" />
      </button>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`${file.filename} 的操作`}
            className="rah-file-menu"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setMenu(false);
            }}
          >
            {onSource && (
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  setMenu(false);
                  onSource();
                }}
              >
                跳转到原消息
              </button>
            )}
            <button
              role="menuitem"
              type="button"
              onClick={() => void download()}
            >
              下载文件
            </button>
          </div>,
          document.body,
        )}
      {error && <span role="alert">{error}</span>}
      {preview && (
        <FilePreview
          file={file}
          onClose={() => setPreview(false)}
          onDownload={() => void download()}
        />
      )}
    </div>
  );
}
function FilePreview({
  file,
  onClose,
  onDownload,
}: {
  file: Attachment;
  onClose: () => void;
  onDownload: () => void;
}) {
  const context = useContext(FilesContext);
  const kind = classifyAttachmentPreview(file.mimeType, file.filename);
  const [content, setContent] = useState<{
    text?: string;
    image?: string;
    error?: string;
  }>();
  const dialogRef = useDialogProtocol({ blocked: false, onClose });
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
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
      ? context.client.files
          .download(file.attachmentId, controller.signal)
          .then(async (blob) => {
            url = URL.createObjectURL(
              new Blob([blob], { type: file.mimeType }),
            );
            return { image: url };
          })
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
      if (url) URL.revokeObjectURL(url);
    };
  }, [context?.client, file, kind]);
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
        role="dialog"
        aria-modal="true"
        aria-label={`预览 ${file.filename}`}
        tabIndex={-1}
        ref={dialogRef}
      >
        <header>
          <h2>{file.filename}</h2>
          <button type="button" onClick={onDownload}>
            下载
          </button>
          <button
            type="button"
            className="sq-btn"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="rah-file-preview-body">
          {!content ? (
            <p>正在加载…</p>
          ) : content.image ? (
            <img alt={file.filename} src={content.image} />
          ) : content.text !== undefined ? (
            kind === "image" || kind === "unsupported" ? (
              <p>此文件不提供内嵌预览，请下载查看。</p>
            ) : (
              <AttachmentTextPreview
                filename={file.filename}
                kind={kind}
                text={content.text}
              />
            )
          ) : (
            <p>{content.error}</p>
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
          <p className="rah-empty-copy">
            暂无文件。在聊天中发送附件后，文件会显示在这里。
          </p>
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
