import { copyTextWithFeedback } from "./copy-text";
import { localMessagePermalink } from "./message-links";
import { uiActionProps } from "./ui-action-props.ts";
import type { RahClient } from "@rah-os/client-sdk";
import { useSavedMessages } from "./useSavedMessages.ts";
import { savedEntry } from "./saved-entry.ts";
// Structural port of official SavedPanel; native list/layout retained, Loom owns data/navigation.
import { memo, useCallback, useEffect, useRef } from "react";
import { useIntl } from "react-intl";
import { Bookmark, Copy, Link } from "lucide-react";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  PanelToggleAction,
  ListRow,
  ThreadIcon,
} from "raft-ui";
import type { SavedEntry } from "../packages/web/src/store/savedStore.ts";
import { formatRelativeTime } from "../packages/web/src/utils/relativeTime.ts";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader";
import EmptyState from "../packages/web/src/components/ui/EmptyState";
import { ConversationCardSkeleton } from "../packages/web/src/components/ui/Skeleton";

function stopKeyPropagation(event: React.KeyboardEvent) {
  event.stopPropagation();
}

const SavedItem = memo(function SavedItem({
  entry,
  onOpenEntry,
  onRemoveMessage,
  serverSlug,
}: {
  entry: SavedEntry;
  onOpenEntry: (entry: SavedEntry) => void;
  onRemoveMessage: (messageId: string) => void;
  serverSlug: string | undefined;
}) {
  const { formatMessage, locale } = useIntl();

  const isThread = entry.channelType === "thread";
  const isDm = isThread
    ? entry.parentChannelType === "dm"
    : entry.channelType === "dm";
  const sourceChannelName = isThread
    ? entry.parentChannelName
    : entry.channelName;
  const channelLabel = isDm
    ? `@${entry.senderName || entry.senderId}`
    : `#${sourceChannelName}`;

  const senderAgent =
    entry.senderType === "agent" ? { avatarUrl: entry.senderAvatarUrl } : null;
  const senderName = entry.senderName;

  const handleRemove = useCallback(() => {
    onRemoveMessage(entry.messageId);
  }, [entry.messageId, onRemoveMessage]);

  const handleRemoveButtonClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onRemoveMessage(entry.messageId);
    },
    [entry.messageId, onRemoveMessage],
  );

  const handleOpen = useCallback(() => {
    onOpenEntry(entry);
  }, [entry, onOpenEntry]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleOpen();
      }
    },
    [handleOpen],
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <ListRow
            variant="plain"
            render={<div />}
            role="button"
            tabIndex={0}
            data-saved-row=""
            onClick={handleOpen}
            onKeyDown={handleKeyDown}
          />
        }
      >
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex min-w-0 items-center gap-2 text-caption">
            <span className="min-w-0 truncate text-foreground-hint">
              {channelLabel}
            </span>
            {isThread && (
              <span className="inline-flex shrink-0 items-center gap-1 text-foreground-hint">
                <ThreadIcon width={12} height={12} />
                {formatMessage({ id: "saved.threadLabel" })}
              </span>
            )}
            {senderName && (
              <span className="inline-flex min-w-0 items-center gap-1 font-semibold text-foreground">
                {senderAgent ? (
                  <AvatarSlot
                    context="preview-mini"
                    type="agent"
                    agentAvatarUrl={senderAgent.avatarUrl ?? null}
                  />
                ) : entry.senderType === "external_projection" ? (
                  <AvatarSlot
                    context="preview-mini"
                    type="app"
                    appAvatarUrl={entry.senderAvatarUrl}
                    appInitials={senderName}
                  />
                ) : (
                  <AvatarSlot
                    context="preview-mini"
                    type="human"
                    humanAvatarUrl={entry.senderAvatarUrl}
                  />
                )}
                <span className="truncate">{senderName}</span>
              </span>
            )}
            <span className="shrink-0 font-mono text-mono-meta text-foreground-hint">
              {formatRelativeTime(entry.createdAt, locale) ?? ""}
            </span>
          </div>
          <p className="line-clamp-3 text-callout text-foreground">
            {entry.content}
          </p>
        </div>
        <div className="ml-auto shrink-0 self-center">
          <PanelToggleAction
            pressed
            onKeyDown={stopKeyPropagation}
            onClick={handleRemoveButtonClick}
            aria-label={formatMessage({ id: "saved.remove" })}
            className="data-pressed:border-transparent data-pressed:bg-transparent data-pressed:text-foreground data-pressed:hover:bg-fill-medium"
          >
            <Bookmark size={14} fill="currentColor" aria-hidden />
          </PanelToggleAction>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem
          onClick={() =>
            void copyTextWithFeedback(
              localMessagePermalink(
                location.origin,
                entry.parentChannelId || entry.channelId,
                entry.messageId,
                entry.channelType === "thread"
                  ? entry.parentMessageId
                  : undefined,
              ),
            )
          }
        >
          <Link size={14} />
          <span>{formatMessage({ id: "saved.copyLink" })}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => void copyTextWithFeedback(entry.content)}
        >
          <Copy size={14} />
          <span>{formatMessage({ id: "saved.copyMarkdown" })}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleRemove}>
          <Bookmark size={14} />
          <span>{formatMessage({ id: "saved.remove" })}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export default function SavedPanel({
  client,
  workspaceId,
  onOpenEntry,
  onMobileBack,
}: {
  client: RahClient;
  workspaceId: string;
  onOpenEntry: (entry: SavedEntry) => void;
  onMobileBack: () => void;
}) {
  const { formatMessage } = useIntl();
  const {
    result,
    loading,
    error,
    read,
    remove: removeSavedMessage,
    writes,
    state,
  } = useSavedMessages(client, workspaceId);
  const saved = (result?.items ?? []).map(savedEntry);
  const savedTotal = result?.globalTotal ?? 0;
  const hasMore = !!result?.nextCursor;
  const loadMore = useCallback(() => read(true), [read]);
  const openSavedEntry = onOpenEntry;
  const embedded = false,
    serverSlug = undefined;
  const scrollerRef = useRef<HTMLDivElement | null>(null),
    loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore || loading || saved.length === 0) return;
    if (typeof IntersectionObserver === "undefined") return;
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      {
        root: scrollerRef.current,
        rootMargin: "240px 0px",
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, loading, saved.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-layer-panel">
      {!embedded ? (
        <PanelHeader
          title={formatMessage({ id: "saved.header.title" })}
          subtitle={formatMessage(
            { id: "saved.header.subtitle" },
            { count: savedTotal },
          )}
          onMobileBack={onMobileBack}
        />
      ) : null}

      {(error || state === "unknown") && (
        <div role="alert" className="p-3 text-sm">
          {error || "收藏操作结果未知。"}
          {state === "unknown" ? (
            <>
              <Button
                {...uiActionProps.recovery}
                onClick={() => void writes.retry()}
              >
                核实收藏结果
              </Button>
              <Button
                {...uiActionProps.recovery}
                onClick={() => {
                  writes.abandon();
                  void read();
                }}
              >
                放弃核实并刷新
              </Button>
            </>
          ) : (
            <Button {...uiActionProps.recovery} onClick={() => void read()}>
              重试
            </Button>
          )}
        </div>
      )}
      {/* Saved list */}
      <div
        ref={scrollerRef}
        data-testid="saved-list-scroller"
        className="flex-1 overflow-y-auto bg-layer-panel py-1 safe-bottom"
      >
        {loading && saved.length === 0 ? (
          <ConversationCardSkeleton />
        ) : saved.length === 0 ? (
          <EmptyState
            className="flex h-full flex-col items-center justify-center"
            icon={<Bookmark size={36} />}
            title={formatMessage({ id: "emptyState.noSavedTitle" })}
            description={formatMessage({ id: "saved.emptyDescription" })}
          />
        ) : (
          <div className="flex flex-col">
            {saved.map((entry) => (
              <SavedItem
                key={entry.messageId}
                entry={entry}
                serverSlug={serverSlug}
                onOpenEntry={openSavedEntry}
                onRemoveMessage={removeSavedMessage}
              />
            ))}
            {hasMore && (
              <div
                ref={loadMoreSentinelRef}
                data-testid="saved-infinite-scroll-sentinel"
                className="flex min-h-10 items-center justify-center py-3"
                aria-live="polite"
              >
                {loading ? (
                  <span className="text-xs font-bold text-foreground-muted">
                    {formatMessage({ id: "common.loading" })}
                  </span>
                ) : (
                  <span className="sr-only">
                    {formatMessage({ id: "saved.loadingMore" })}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
