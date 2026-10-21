// GENERATED from Raft db5e399; Loom comment data/authority bindings.
import { useAttachmentComments as useLoomAttachmentComments } from "./useAttachmentComments";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { ChevronDown, ChevronUp, FileText, MapPin, X } from "lucide-react";
import api from "./upstream-api";
import MessageInput from "../packages/web/src/components/message/MessageInput";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot";
import {
  anchorLabel,
  anchorOrderKey,
  anchorQuote,
  jumpToAnchor,
} from "../packages/web/src/components/message/attachmentCommentAnchors";
import type {
  CommentAnchor,
  StoredAnchor,
} from "../packages/web/src/components/message/attachmentCommentAnchors";
import { getSocket } from "../packages/web/src/api/socket";
import { useMessageStore } from "../packages/web/src/store/messageStore";
import type { Message } from "../packages/web/src/store/messageStore";
import { useAuthStore } from "../packages/web/src/store/authStore";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter";
import MarkdownContent from "../packages/web/src/components/markdown/MarkdownContent";
import { Card, Spinner, Button } from "raft-ui";
import AttachmentTooltip from "../packages/web/src/components/message/attachmentTooltip";
import { COMPOSER_DOCK_CLASS } from "../packages/web/src/components/message/composerHost";

// Attachment comments panel (attachment-comments MVP spec §5/§5b).
//
// Renders inside AttachmentPreviewShell as a side panel. A comment is a
// normal message in the attachment's parent-message thread; this panel is a
// FILTERED view (refs only) with a composer that posts through
// POST /attachments/:id/comments. General thread replies intentionally never
// appear here — that split is the §6.5 scope-path × visibility contract.

interface CommentReaction {
  emoji: string;
  reactorType: "user" | "agent";
  reactorId: string;
}

interface AttachmentComment {
  id: string;
  channelId: string;
  senderType: "user" | "agent";
  senderId: string;
  senderName: string;
  content: string;
  createdAt: string;
  reactions: CommentReaction[];
  /** Structural anchor (task #15) — null for unanchored comments. */
  anchor: StoredAnchor | null;
  senderAvatarUrl: string | null;
  senderGravatarHash: string | null;
}

type ViewerState = {
  canComment: boolean;
  reason: "ok" | "not_member" | "archived" | "unlinked" | "read_only";
};


export function AttachmentCommentsPanel({
  attachmentId,
  filename,
  parentMessage,
  pendingAnchor,
  getPendingAnchor,
  onAnchorCleared,
  onAnchorJump,
  sheetControls,
  collapsedBody,
}: {
  attachmentId: string;
  filename: string;
  parentMessage: Pick<Message, "id" | "channelId">;
  /** Structural anchor captured from the selection at open time (task #15). */
  pendingAnchor?: CommentAnchor | null;
  /** Read the shell's latest pending anchor at submit time, before React renders the prop update. */
  getPendingAnchor?: () => CommentAnchor | null;
  /** Keep the preview shell's pending-anchor state in sync when this panel clears it. */
  onAnchorCleared?: () => void;
  /**
   * Fired after a successful anchor jump — the mobile sheet collapses so the
   * flash highlight is visible instead of hidden behind the panel (task #26).
   */
  onAnchorJump?: () => void;
  /**
   * Mobile sheet integration (cindyz 6/11): the expand/collapse chevron
   * renders inside the panel's control row — there is no separate handle
   * bar. Absent on desktop surfaces.
   */
  sheetControls?: { expanded: boolean; onToggle: () => void };
  /** Hide list+composer (display:none → out of tab order/a11y tree) while
   *  the mobile sheet is collapsed to its header row. */
  collapsedBody?: boolean;
}) {
  const { formatMessage } = useIntl();
  const { formatMessageTime } = useTimeFormatter();
  const { comments, pendingComments, error, listRef, activeAnchor, clearActiveAnchor, sendComment, controls, canComment, submitDisabled, writeBlockedCopy } = useLoomAttachmentComments({ attachmentId, parentMessage, pendingAnchor, getPendingAnchor, onAnchorCleared });
  // Fixed order (cindyz 6/11, task #28): by anchor position in the document;
  // comments WITHOUT a position always sit on top. No user-facing sort
  // control — this is the list's one canonical order.
  const visible = [...(comments ?? []), ...pendingComments]
    .map((c) => ({ c, key: c.anchor ? anchorOrderKey(c.anchor) : null }))
    .sort((a, b) => {
      const ka = a.key ?? Number.NEGATIVE_INFINITY;
      const kb = b.key ?? Number.NEGATIVE_INFINITY;
      if (ka !== kb) return ka - kb;
      return a.c.createdAt.localeCompare(b.c.createdAt);
    })
    .map(({ c }) => c);

  /* Pending-anchor chip, built once so the quote tooltip can wrap it
     conditionally (title= migration: native title showed the anchor's quote
     on hover; absent a quote there is no tooltip at all). */
  const pendingAnchorChip = activeAnchor ? (
    <span
      data-message-affordance="attachment-comment-pending-anchor"
      className="inline-flex max-w-full items-center gap-1 overflow-hidden rounded-chip bg-fill-muted px-1.5 py-0.5 text-caption font-semibold text-foreground"
    >
      <MapPin size={12} className="shrink-0" />
      <span className="min-w-0 truncate">{anchorLabel(activeAnchor, formatMessage)}</span>
      <AttachmentTooltip content={formatMessage({ id: "message.attachmentComments.removeAnchor" })}>
      <button
        type="button"
        aria-label={formatMessage({ id: "message.attachmentComments.removeAnchor" })}
        onClick={clearActiveAnchor}
        className="shrink-0 rounded-[2px] text-foreground-muted outline-none hover:text-foreground focus-visible:shadow-focus"
      >
        <X size={12} />
      </button>
      </AttachmentTooltip>
    </span>
  ) : null;
  const pendingAnchorQuote = activeAnchor ? anchorQuote(activeAnchor) : undefined;

  return (
    <div className="flex h-full w-full flex-col bg-layer-canvas">
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-line-seam px-3 py-1.5">
        <AttachmentTooltip content={formatMessage({ id: "message.attachmentComments.titleTooltip" }, { filename })}>
        <span className="min-w-0 flex-1 truncate text-footnote font-bold text-foreground">
          {formatMessage({ id: "message.attachmentComments.header" }, { filename })}
        </span>
        </AttachmentTooltip>
        {sheetControls ? (
          <AttachmentTooltip content={formatMessage({ id: sheetControls.expanded ? "message.attachmentComments.collapse" : "message.attachmentComments.expand" })}>
          <Button size="icon-sm" variant="ghost"
            type="button"
            aria-label={formatMessage({ id: sheetControls.expanded ? "message.attachmentComments.collapse" : "message.attachmentComments.expand" })}
            data-slot="button"
            aria-expanded={sheetControls.expanded}
            onClick={sheetControls.onToggle}
            data-message-affordance="attachment-comments-sheet-toggle"
          >
            {sheetControls.expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </Button>
          </AttachmentTooltip>
        ) : null}
      </div>

      {controls}
      <div ref={listRef} className={`min-h-0 flex-1 overflow-y-auto px-3 py-2 ${collapsedBody ? "hidden" : ""}`}>
        {comments === null ? (
          <div className="flex h-full items-center justify-center"><Spinner size="sm" aria-label={formatMessage({ id: "common.loadingLabel" })} /></div>
        ) : visible.length === 0 ? (
          <p className="px-1 py-3 text-footnote text-foreground-muted">
            {formatMessage(
              { id: "message.attachmentComments.emptyHint" },
              {
                filename,
                strong: (chunks) => <span className="font-bold" key="attachment-comments-empty-hint-filename">{chunks}</span>,
              },
            )}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {visible.map((c) => {
              const jump = c.anchor
                ? () => {
                    if (jumpToAnchor(c.anchor!)) onAnchorJump?.();
                  }
                : null;
              /* Figma-list card (cindyz 6/11): avatar-led header, anchor chip
                 as location ref, body. The whole card is the jump affordance
                 when an anchor exists — a real <button> (semantic, lint-
                 clean); the resolve control is a SIBLING in the corner, not
                 nested inside it. This location-ref card explicitly keeps the
                 arrow cursor even though normal app controls use the link hand. */
              const inner = (
                <>
                  <div className="flex items-center gap-1.5 pr-6">
                    <AvatarSlot
                      context="compact-list"
                      type={c.senderType === "agent" ? "agent" : "human"}
                      agentAvatarUrl={c.senderType === "agent" ? c.senderAvatarUrl : undefined}
                      humanAvatarUrl={c.senderType === "user" ? c.senderAvatarUrl : undefined}
                      gravatarHash={c.senderType === "user" ? c.senderGravatarHash : undefined}
                    />
                    <span className="min-w-0 flex-1 truncate text-footnote font-bold text-foreground">{c.senderName}</span>
                    <span className="shrink-0 font-mono text-mono-meta text-foreground-hint">
                      {formatMessageTime(c.createdAt)}
                    </span>
                  </div>
                  <span
                    data-message-affordance="attachment-comment-anchor"
                    className="mt-1 inline-flex max-w-full items-center gap-1 overflow-hidden rounded-chip bg-fill-muted px-1.5 py-0.5 text-caption font-semibold text-foreground"
                  >
                    {c.anchor ? <MapPin size={12} className="shrink-0" /> : <FileText size={12} className="shrink-0" />}
                    <span className="min-w-0 truncate">{c.anchor ? anchorLabel(c.anchor, formatMessage) : filename}</span>
                  </span>
                  {c.anchor && typeof (c.anchor.data as Record<string, unknown>)?.quote === "string" && (c.anchor.data as Record<string, unknown>).quote ? (
                    <div className="mt-1 whitespace-pre-wrap break-words border-l-2 border-line-seam pl-2.5 text-caption font-normal text-foreground-muted">
                      {(c.anchor.data as Record<string, unknown>).quote as string}
                    </div>
                  ) : null}
                  <div className="mt-1 text-footnote text-foreground">
                    <MarkdownContent source={c.content} density="compact" enableMermaid />
                  </div>
                </>
              );
              return (
                <li key={c.id} className="relative">
                  {jump ? (
                    <AttachmentTooltip content={anchorQuote(c.anchor!) ?? formatMessage({ id: "message.attachmentComments.jumpToLocation" })}>
                    <Card
                      render={<button type="button" onClick={jump} />}
                      className="block w-full px-3 py-2.5 text-left outline-none hover:press-overlay active:press-overlay focus-visible:shadow-focus"
                    >
                      {inner}
                    </Card>
                    </AttachmentTooltip>
                  ) : (
                    <Card className="block px-3 py-2.5">{inner}</Card>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={`${COMPOSER_DOCK_CLASS} ${collapsedBody ? "hidden" : ""}`} data-message-affordance="attachment-comment-composer">
        {canComment ? (
          <>
            {/* Inherited composer (task #20, cindyz + Dozy): the channel/
                thread MessageInput in compact form — drafts, mentions,
                shortcuts, IME guard, sending/error states all come from the
                base. Comment-specific surface = the two chips (accessoryRow)
                + delivery override (ref/anchor pairing). Draft key is a
                synthetic per-attachment slot; mention scope = the parent
                channel the attachment lives in. */}
            <MessageInput
              submitDisabled={submitDisabled}
              showTaskButton={false}
              channelId={`attachment-comment:${attachmentId}`}
              channelName={filename}
              placeholder={formatMessage({ id: "message.attachmentComments.composerPlaceholder" }, { filename })}
              variant="compact"
              mentionChannelId={parentMessage.channelId}
              isChannelThread
              onSendOverride={sendComment}
              accessoryRow={
                /* Scope is already stated by the panel header + placeholder,
                   so no re: chip here (cindyz task #21); only the location
                   anchor rides above the input, attachment-strip style.
                   Box + tint synced with the comment anchor chips (a DS
                   token chip on fill-muted — cindyz 6/11). */
                pendingAnchorChip && pendingAnchorQuote ? (
                  <AttachmentTooltip content={pendingAnchorQuote}>{pendingAnchorChip}</AttachmentTooltip>
                ) : (
                  pendingAnchorChip
                )
              }
            />
            {error ? <p className="mt-1 text-caption text-danger-strong">{error}</p> : null}
          </>
        ) : (
          <p
            data-message-affordance="attachment-comment-composer-disabled"
            className="px-1 py-1.5 text-footnote text-foreground-hint"
          >
            {writeBlockedCopy}
          </p>
        )}
      </div>
    </div>
  );
}
