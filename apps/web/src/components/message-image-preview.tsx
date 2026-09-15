import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RoomMessageView } from "@rah-os/ui-web";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { MessageMarkdown } from "./message-markdown.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { formatRahDateTime } from "../date-time-presentation.ts";

export function MessageImagePreview({
  messages,
  onClose,
}: {
  messages: readonly RoomMessageView[];
  onClose: () => void;
}) {
  const ref = useDialogProtocol({ blocked: false, onClose });
  const content = useRef<HTMLDivElement>(null);
  const entities = useWorkspaceEntities();
  const [image, setImage] = useState<{ blob: Blob; url: string }>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false,
      url: string | undefined;
    setError(undefined);
    void (async () => {
      await document.fonts.ready;
      const node = content.current;
      if (!node || cancelled) return;
      if (node.scrollWidth * node.scrollHeight > 16_000_000)
        throw new Error("所选消息超出单张图片尺寸，请减少选择后重试。");
      const { toBlob } = await import("html-to-image");
      const blob = await toBlob(node, {
        pixelRatio: 1,
        backgroundColor: "#fff",
      });
      if (!blob) throw new Error("生成图片失败，请重试。");
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setImage({ blob, url });
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "生成图片失败");
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [attempt]);
  async function copyImage() {
    if (!image) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": image.blob }),
      ]);
      setError(undefined);
    } catch {
      setError("无法写入图片剪贴板，可以下载图片。");
    }
  }
  return createPortal(
    <div className="rah-dialog-layer rah-message-image-layer">
      <button
        className="rah-dialog-backdrop"
        aria-label="关闭分享预览背景"
        onClick={onClose}
      />
      <section
        className="rah-dialog rah-message-image-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="分享预览"
        ref={ref}
        tabIndex={-1}
      >
        <header>
          <h2>分享预览</h2>
          <button
            type="button"
            className="sq-btn"
            aria-label="关闭分享预览"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="rah-message-image-scroll">
          {image ? <img src={image.url} alt="所选消息图片" /> : null}
          <div
            className={
              image
                ? "rah-message-image-source is-rendered"
                : "rah-message-image-source"
            }
            ref={content}
          >
            <div className="rah-message-image-brand">RAH Workstation</div>
            {messages.map((message) => {
              const person =
                entities?.person(message.actorId) ??
                entities?.resolvePerson({
                  principalId: message.actorId,
                  handle: message.author,
                  kind: "human",
                });
              const name =
                person?.displayName || person?.handle || message.author;
              return (
                <article key={message.messageId}>
                  <ProfileImageAvatar
                    avatarKey={person?.avatarKey}
                    name={name}
                    principalId={message.actorId}
                    kind={person?.kind ?? "human"}
                  />
                  <div className="msg-body">
                    <header>
                      <strong>{name}</strong>
                      <time>
                        {formatRahDateTime(message.createdAt, {
                          month: "2-digit",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </header>
                    <MessageMarkdown source={message.body} />
                  </div>
                </article>
              );
            })}
          </div>
        </div>
        <footer>
          {error ? (
            <span role="alert">
              {error}
              {!image ? (
                <button onClick={() => setAttempt((x) => x + 1)}>重试</button>
              ) : null}
            </span>
          ) : !image ? (
            <span role="status">正在生成…</span>
          ) : null}
          <button
            className="btn"
            disabled={!image}
            onClick={() => void copyImage()}
          >
            <Icon name="copy" />
            复制图片
          </button>
          <a
            className="btn"
            aria-disabled={!image}
            href={image?.url}
            download="rah-messages.png"
            onClick={(e) => {
              if (!image) e.preventDefault();
            }}
          >
            <Icon name="download" />
            下载
          </a>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
