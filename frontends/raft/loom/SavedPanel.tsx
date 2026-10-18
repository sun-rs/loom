import { uiActionProps } from "./ui-action-props.ts";
import type { RahClient } from "@rah-os/client-sdk";
import { useSavedMessages } from "./useSavedMessages.ts";
import { savedEntry } from "./saved-entry.ts";
// Structural port of official SavedPanel; native card/layout retained, Loom owns data/navigation.
import { memo, useCallback, useEffect, useRef } from "react";
import { useIntl } from "react-intl";
import { Bookmark, MessageSquare } from "lucide-react";
import {
  Button,
  Card,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  PanelToggleAction,
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
          <Card
            render={<div role="button" tabIndex={0} />}
            onClick={handleOpen}
            onKeyDown={handleKeyDown}
            className="relative flex flex-row items-center gap-3 transition-colors p-3 text-left w-full shadow-none border-line-muted theme-brutal:border-2 theme-brutal:border-black bg-layer-panel theme-brutal:bg-white hover:bg-fill-muted data-[popup-open]:bg-fill-muted"
          />
        }
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 text-xs">
            <span className="font-bold text-foreground-muted theme-brutal:text-black/50">
              {channelLabel}
            </span>
            {isThread && (
              <span className="inline-flex items-center gap-1 font-bold text-foreground-muted theme-brutal:text-black/40">
                <MessageSquare size={10} />
                {formatMessage({ id: "saved.threadLabel" })}
              </span>
            )}
            {senderName && (
              <span className="inline-flex items-center gap-1 font-bold text-foreground-strong theme-brutal:text-black">
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
                <span>{senderName}</span>
              </span>
            )}
            <span className="text-xs text-foreground-muted font-mono theme-brutal:text-black/40">
              {formatRelativeTime(entry.createdAt, locale) ?? ""}
            </span>
          </div>
          <p className="text-sm line-clamp-3">{entry.content}</p>
        </div>
        <div className="ml-auto shrink-0 self-center">
          <PanelToggleAction
            pressed
            onKeyDown={stopKeyPropagation}
            onClick={handleRemoveButtonClick}
            aria-label={formatMessage({ id: "saved.remove" })}
            className="data-pressed:text-accent-strong theme-brutal:data-pressed:text-brutal-orange data-pressed:bg-accent-soft/30"
          >
            <Bookmark
              size={14}
              fill="currentColor"
              className="text-accent-strong theme-brutal:text-brutal-orange"
              aria-hidden
            />
          </PanelToggleAction>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
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
    <div className="flex min-h-0 flex-1 flex-col bg-layer-canvas-muted theme-brutal:bg-white">
      {!embedded ? (
        <PanelHeader
          title={formatMessage({ id: "saved.header.title" })}
          subtitle={formatMessage(
            { id: "saved.header.subtitle" },
            { count: savedTotal },
          )}
          icon={<Bookmark size={18} />}
          iconBg="bg-primary-soft"
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
        className="flex-1 overflow-y-auto bg-layer-canvas-muted p-4 safe-bottom theme-brutal:bg-white"
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
          <div className="flex flex-col gap-2">
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
