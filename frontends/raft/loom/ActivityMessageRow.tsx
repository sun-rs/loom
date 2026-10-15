import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import { useRef, useEffect } from "react";
// Structural port of ThreadsInbox.tsx InboxRow (upstream revision in adoption.json).
// Keep the original Card geometry/state classes; Loom supplies canonical row data.
// Done uses the existing activity frontier; context-menu/task controls remain unbound.
import { useIntl } from "react-intl";
import { Badge, Button, Card, DirectMessageIcon, ThreadIcon } from "raft-ui";
import { Hash, Check } from "lucide-react";
import { formatRelativeTime } from "../packages/web/src/utils/relativeTime.ts";
import InlineMarkdownPreview from "../packages/web/src/components/markdown/InlineMarkdownPreview.tsx";
import type { DiscoveryRow } from "./discovery-client.ts";
export default function ActivityMessageRow({
  row,
  active,
  onOpen,
  onDone,
  pending,
}: {
  row: DiscoveryRow;
  onDone: () => void;
  pending: boolean;
  active: boolean;
  onOpen: (full: boolean) => void;
}) {
  const { formatMessage, locale } = useIntl();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const activate = (detail: number) => {
    clearTimeout(timer.current);
    if (!window.matchMedia("(min-width: 1024px)").matches || detail >= 2)
      onOpen(true);
    else timer.current = setTimeout(() => onOpen(false), 220);
  };
  const unreadCount = row.unread ?? 0;
  const thread = row.activityKind === "thread";
  const iconClass =
    "mr-1.5 inline-block align-[-2px] text-foreground-placeholder theme-brutal:text-black/45";
  const icon = thread ? (
    <ThreadIcon width={13} height={13} className={iconClass} />
  ) : row.activityKind === "direct" ? (
    <DirectMessageIcon width={13} height={13} className={iconClass} />
  ) : (
    <Hash size={13} className={iconClass} />
  );
  const hasRowAction = Boolean(row.activityFrontier);
  const rowActionVisibilityClassName = active
    ? "pointer-events-auto opacity-100"
    : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-visible:pointer-events-auto group-focus-visible:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100";
  const timestampVisibilityClassName = !hasRowAction
    ? ""
    : active
      ? "opacity-0"
      : "transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:opacity-0";
  const rowActionBackgroundClassName = active
    ? "bg-layer-panel theme-brutal:bg-white"
    : "bg-transparent group-hover:bg-layer-panel group-focus-visible:bg-layer-panel group-focus-within:bg-layer-panel [@media(hover:none)]:bg-layer-panel theme-brutal:group-hover:bg-white theme-brutal:group-focus-visible:bg-white theme-brutal:group-focus-within:bg-white theme-brutal:[@media(hover:none)]:bg-white";
  const done = () => {
    clearTimeout(timer.current);
    if (!pending) onDone();
  };
  return (
    <Card
      role="button"
      tabIndex={0}
      data-result-id={row.id}
      data-testid="inbox-row"
      data-active={active ? "true" : undefined}
      aria-current={active ? "true" : undefined}
      onClick={(event) => activate(event.detail)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate(1);
        }
      }}
      className={`group relative flex w-full items-start gap-3 rounded-md border p-3 theme-brutal:rounded-none text-left transition-colors hover:border-line-muted hover:bg-fill-muted hover:shadow-raft-sm active:border-line-muted active:shadow-raft-sm theme-brutal:border-2 theme-brutal:hover:border-black theme-brutal:hover:shadow-brutal-sm theme-brutal:active:border-black theme-brutal:active:shadow-brutal-sm ${active ? "border-line-muted bg-fill-muted shadow-raft-sm theme-brutal:border-black theme-brutal:bg-white theme-brutal:shadow-brutal-sm" : "border-line-muted bg-layer-card theme-brutal:border-black/30 theme-brutal:bg-white"}`}
    >
      <div className="min-w-0 w-full" data-testid="conversation-card-content">
        {thread && (
          <div
            className="mb-0.5 min-w-0 text-[11px] font-bold leading-3 text-foreground-placeholder theme-brutal:text-black/45"
            data-testid="conversation-card-subtitle"
          >
            {row.roomName}
          </div>
        )}
        <div className="mb-0.5 flex min-w-0 items-start gap-2">
          <div
            className={`line-clamp-2 min-w-0 flex-1 text-sm leading-5 ${unreadCount > 0 ? "font-bold text-foreground-strong theme-brutal:text-black" : "font-semibold text-foreground-muted theme-brutal:text-black/55"}`}
            data-testid="conversation-card-primary"
          >
            <span aria-hidden="true">{icon}</span>
            {row.label}
          </div>
          <span
            className={`shrink-0 font-mono text-xs leading-5 text-foreground-placeholder theme-brutal:text-black/40 ${timestampVisibilityClassName}`}
            data-testid="conversation-card-timestamp"
          >
            {formatRelativeTime(row.message.createdAt, locale)}
          </span>
        </div>
        <p
          className={`line-clamp-2 text-xs leading-4 ${unreadCount > 0 ? "text-foreground-strong theme-brutal:text-black" : "text-foreground-muted theme-brutal:text-black/55"}`}
          data-testid="conversation-card-body"
        >
          <span className="font-bold text-foreground-muted theme-brutal:text-black/70">
            {row.senderName}:{" "}
          </span>
          <InlineMarkdownPreview markdown={row.message.body || "附件消息"} />
        </p>
        <div
          className="mt-1 flex min-h-5 flex-wrap items-center gap-1.5"
          data-testid="conversation-card-metadata"
        >
          {thread && (
            <Badge appearance="outline" variant="muted" uppercase={false}>
              {formatMessage(
                { id: "thread.row.replies" },
                { count: row.replyCount ?? 0 },
              )}
            </Badge>
          )}
          {unreadCount > 0 && (
            <Badge
              variant="accent"
              uppercase={false}
              data-testid="conversation-card-new-badge"
            >
              {formatMessage(
                { id: "thread.row.unreadCount" },
                { count: unreadCount },
              )}
            </Badge>
          )}
        </div>
      </div>
      {hasRowAction && (
        <div
          className={`pointer-events-none absolute right-3 top-3 z-10 flex items-center rounded-md theme-brutal:rounded-none ${rowActionBackgroundClassName}`}
          data-testid="conversation-card-actions"
        >
          <Tooltip content={formatMessage({ id: "thread.row.markAsDone" })}>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              disabled={pending}
              onClick={(event) => {
                event.stopPropagation();
                done();
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                done();
              }}
              className={`relative z-10 shrink-0 transition-opacity theme-brutal:bg-white ${rowActionVisibilityClassName}`}
              aria-label={formatMessage({ id: "thread.row.markAsDone" })}
              data-testid="inbox-row-done"
            >
              <Check size={14} />
            </Button>
          </Tooltip>
        </div>
      )}
    </Card>
  );
}
