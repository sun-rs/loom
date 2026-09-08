import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import {
  ComposerMentionMenu,
  useComposerMention,
} from "./composer-mention.tsx";
import { mentionedRoomAgentIds } from "@rah-os/ui-web";
import { MessageMarkdown } from "./message-markdown.tsx";
import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { RoomSession, runRoomMutationAtLatest } from "@rah-os/client-core";
import type { AttachmentPreviewKind } from "@rah-os/protocol";
import { useReconciledQuery } from "../use-reconciled-query.ts";
import { handleComposerKeyDown } from "../composer-keyboard.ts";
import { navigationSearch } from "../navigation-target.ts";
import { formatRahDateTime } from "../date-time-presentation.ts";
import {
  attachmentAnchorLabel,
  attachmentAnchorTarget,
  orderAttachmentComments,
  type AttachmentAnchor,
} from "../attachment-comment-anchors.ts";

export function AttachmentComments({
  client,
  attachmentId,
  filename,
  kind,
  open,
  pendingAnchor,
  onClearAnchor,
  onToggle,
  onJump,
}: {
  client: RahClient;
  attachmentId: string;
  filename: string;
  kind: AttachmentPreviewKind;
  open: boolean;
  pendingAnchor: AttachmentAnchor | undefined;
  onClearAnchor: () => void;
  onToggle: () => void;
  onJump: (anchor: AttachmentAnchor) => boolean;
}) {
  const [beforeRoomSeq, setBeforeRoomSeq] = useState<number>();
  const [revision, setRevision] = useState(0),
    [body, setBody] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string>(),
    [status, setStatus] = useState<string>();
  const request = useReconciledQuery(
    client,
    "file.comments",
    {
      attachmentId,
      limit: 50,
      ...(beforeRoomSeq === undefined ? {} : { beforeRoomSeq }),
    },
    open,
    revision,
  );
  const data = request?.data;
  const entities = useWorkspaceEntities();
  const members = useReconciledQuery(
    client,
    "room.member.list",
    { roomId: data?.roomId ?? "attachment-pending" },
    open && !!data?.roomId,
    revision,
  );
  const memberIds = new Set(
    members?.data?.memberships.map((member) => member.principalId),
  );
  const agents =
    entities?.agents().filter((agent) => memberIds.has(agent.participantId)) ??
    [];
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const menuId = `attachment-mentions-${attachmentId}`;
  const mention = useComposerMention({
    agents,
    body,
    id: menuId,
    setBody,
    textareaRef: composerRef,
  });
  const canComment =
    !!data?.viewer.canComment && !!members?.data && !members.error;
  const currentAnchor = useRef(pendingAnchor);
  currentAnchor.current = pendingAnchor;
  const active = useRef(true),
    sending = useRef(false),
    intent = useRef<
      | { fingerprint: string; idempotencyKey: string; recipientIds: string[] }
      | undefined
    >(undefined);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  async function send() {
    if (sending.current || !canComment || !data || !body.trim()) return;
    const text = body.trim(),
      anchor = pendingAnchor ?? null,
      fingerprint = JSON.stringify([attachmentId, text, anchor]);
    if (intent.current?.fingerprint !== fingerprint)
      intent.current = {
        fingerprint,
        idempotencyKey: crypto.randomUUID(),
        recipientIds: mentionedRoomAgentIds({ agents, body: text }),
      };
    const { idempotencyKey, recipientIds } = intent.current;
    sending.current = true;
    setPending(true);
    setError(undefined);
    try {
      // This is the existing canonical Room reconciliation barrier; comment read
      // metadata supplies its real Room, never the viewer's currently open Room.
      const session = new RoomSession({
        client,
        roomId: data.roomId,
        consumerId: `file-comment-${attachmentId}`,
      });
      await runRoomMutationAtLatest({
        session,
        mutate: (basedOnRoomSeq) =>
          client.request("file.comment", {
            attachmentId,
            body: text,
            anchor,
            recipientIds,
            basedOnRoomSeq,
            idempotencyKey,
          }),
      });
      if (!active.current) return;
      setBody("");
      if (
        JSON.stringify(currentAnchor.current ?? null) === JSON.stringify(anchor)
      )
        onClearAnchor();
      intent.current = undefined;
      setBeforeRoomSeq(undefined);
      setRevision((n) => n + 1);
      setStatus("评论已发送");
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error ? cause.message : "评论发送失败，请重试",
        );
    } finally {
      sending.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <aside
      className="rah-attachment-comments"
      aria-label="文件评论"
      data-collapsed={!open}
    >
      <div className="rah-attachment-comments-heading">
        <strong>评论</strong>
        <button
          type="button"
          className="rah-attachment-comments-sheet-toggle"
          aria-expanded={open}
          aria-label={open ? "收起评论" : "展开评论"}
          title={open ? "收起评论" : "展开评论"}
          onClick={onToggle}
        >
          {open ? "⌄" : "⌃"}
        </button>
        {data?.threadId && (
          <a
            href={navigationSearch({
              target: {
                kind: "thread",
                roomId: data.roomId,
                threadId: data.threadId,
                ...(data.threadRootMessageId
                  ? { rootMessageId: data.threadRootMessageId }
                  : {}),
              },
            })}
          >
            打开讨论
          </a>
        )}
      </div>
      <div className="rah-attachment-comments-list">
        {!data && !request?.error && <p role="status">正在加载评论…</p>}
        {request?.error && (
          <div role="alert">
            {request.error}
            <button type="button" onClick={() => setRevision((n) => n + 1)}>
              重试
            </button>
          </div>
        )}
        {data?.comments.length === 0 && (
          <p className="rah-attachment-comment-empty">暂无评论</p>
        )}
        {data &&
          orderAttachmentComments(data.comments).map((comment) => {
            const anchor = comment.anchor,
              supported = anchor && attachmentAnchorTarget(anchor, kind);
            const meta = (
              <>
                {anchor && (
                  <span className="rah-attachment-anchor-badge">
                    {attachmentAnchorLabel(anchor)}
                  </span>
                )}
                <span className="rah-attachment-comment-meta">
                  <strong>{comment.senderName}</strong>
                  <time>
                    {formatRahDateTime(comment.createdAt, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
                {anchor && typeof anchor.data.quote === "string" && (
                  <span className="rah-attachment-comment-quote">
                    {anchor.data.quote.slice(0, 1000)}
                  </span>
                )}
              </>
            );
            return (
              <div className="rah-attachment-comment-card" key={comment.id}>
                {supported && anchor ? (
                  <button
                    type="button"
                    className="rah-attachment-comment-jump"
                    aria-label={`定位${attachmentAnchorLabel(anchor)}：${comment.content.slice(0, 100)}`}
                    onClick={() =>
                      setStatus(
                        onJump(anchor)
                          ? "已定位评论位置"
                          : "此位置不在当前可呈现的预览范围内",
                      )
                    }
                  >
                    {meta}
                  </button>
                ) : (
                  meta
                )}
                <div className="rah-attachment-comment-body">
                  <MessageMarkdown source={comment.content} />
                </div>
                {anchor && !supported && <small>当前预览不支持此位置</small>}
              </div>
            );
          })}
        {data?.nextBeforeRoomSeq && (
          <button
            type="button"
            onClick={() => setBeforeRoomSeq(data.nextBeforeRoomSeq)}
          >
            更早评论
          </button>
        )}
        {beforeRoomSeq !== undefined && (
          <button type="button" onClick={() => setBeforeRoomSeq(undefined)}>
            最新评论
          </button>
        )}
      </div>
      <form
        className="rah-attachment-comment-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {pendingAnchor ? (
          <div className="rah-attachment-pending-anchor">
            <span>{attachmentAnchorLabel(pendingAnchor)}</span>
            <button
              type="button"
              aria-label="取消位置引用"
              onClick={onClearAnchor}
              disabled={pending}
            >
              ×
            </button>
          </div>
        ) : (
          <small>评论 {filename}</small>
        )}
        {data && !data.viewer.canComment && <p>当前无权评论此附件。</p>}
        {members?.error && (
          <p role="alert">
            {members.error}
            <button type="button" onClick={() => setRevision((n) => n + 1)}>
              重试
            </button>
          </p>
        )}
        <ComposerMentionMenu
          activeIndex={mention.activeIndex}
          agents={mention.candidates}
          id={menuId}
          onSelect={mention.select}
          open={mention.open}
        />
        <textarea
          aria-label="附件评论"
          placeholder="添加评论…"
          value={body}
          maxLength={10000}
          ref={composerRef}
          aria-activedescendant={mention.activeDescendant}
          aria-autocomplete="list"
          aria-controls={menuId}
          aria-expanded={mention.open}
          onBlur={mention.onBlur}
          onChange={mention.onChange}
          onFocus={mention.onFocus}
          onClick={(event) => mention.onSelectionChange(event.currentTarget)}
          onKeyUp={(event) => mention.onSelectionChange(event.currentTarget)}
          onKeyDown={(event) => {
            mention.onKeyDown(event);
            handleComposerKeyDown(event);
          }}
          disabled={pending || !canComment}
        />
        <div className="rah-attachment-comment-footer">
          <span role="status">{status}</span>
          <button
            type="submit"
            disabled={pending || !canComment || !data || !body.trim()}
          >
            {pending ? "发送中…" : "发送评论"}
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
    </aside>
  );
}
