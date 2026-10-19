import type { ComponentProps } from "react";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import ActivityContextMenu, {
  type ActivityMenuTarget,
} from "./ActivityContextMenu.tsx";
import type { ActivityAction } from "./activity-actions.ts";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import { useRef, useEffect, useState, useCallback } from "react";
// Structural port of v1.21.22 ThreadsInbox-CbSKTW4g.js Ie/Le/Re and InboxRow.
// Official list branch, including touch visibility; Done remains in the context menu.
import { useIntl } from "react-intl";
import {
  SidebarItemCount,
  Button,
  DirectMessageIcon,
  ThreadIcon,
} from "raft-ui";
import { Hash, Check } from "lucide-react";
import { formatRelativeTime } from "../packages/web/src/utils/relativeTime.ts";
import InlineMarkdownPreview from "../packages/web/src/components/markdown/InlineMarkdownPreview.tsx";
import type { DiscoveryRow } from "./discovery-client.ts";
export default function ActivityMessageRow({
  client,
  onFollow,
  row,
  active,
  onOpen,
  onAction,
  pending,
}: {
  client: ComponentProps<typeof ActivityContextMenu>["client"];
  onFollow: ComponentProps<typeof ActivityContextMenu>["onFollow"];
  row: DiscoveryRow;
  onAction: (row: DiscoveryRow, action: ActivityAction) => void;
  pending: boolean;
  active: boolean;
  onOpen: (full: boolean) => void;
}) {
  const { formatMessage, locale } = useIntl();
  const root = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<ActivityMenuTarget>();
  const closeMenu = useCallback(() => {
    setMenu(undefined);
    root.current?.focus();
  }, []);
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
  const hasRowAction = Boolean(row.activityFrontier);
  const rowActionVisibilityClassName = active
    ? "pointer-events-auto opacity-100"
    : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-visible:pointer-events-auto group-focus-visible:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 [@media(hover:none)]:hidden";
  const timestampVisibilityClassName = !hasRowAction
    ? ""
    : active
      ? "opacity-0"
      : "transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 [@media(hover:none)]:opacity-100";
  const done = () => {
    clearTimeout(timer.current);
    if (!pending) onAction(row, "done");
  };
  return (
    <>
      <div
        ref={root}
        onContextMenu={(event) => {
          event.preventDefault();
          clearTimeout(timer.current);
          if (row.activityFrontier)
            setMenu({ row, x: event.clientX, y: event.clientY });
        }}
        role="button"
        tabIndex={0}
        data-result-id={row.id}
        data-testid="inbox-row"
        data-layout="list"
        data-active={active ? "true" : undefined}
        aria-current={active ? "true" : undefined}
        onClick={(event) => activate(event.detail)}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            clearTimeout(timer.current);
            const rect = event.currentTarget.getBoundingClientRect();
            if (row.activityFrontier)
              setMenu({ row, x: rect.left + 12, y: rect.bottom });
            return;
          }

          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate(1);
          }
        }}
        className={`group relative flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors focus-visible:shadow-[inset_0_0_0_2px_var(--foreground)] before:pointer-events-none before:absolute before:top-0 before:right-0 before:left-16 before:hidden before:border-t before:border-line-muted [[data-testid=inbox-row]+&]:before:block ${active ? "bg-info-soft" : "hover:bg-fill-pressed"}`}
      >
        <span
          className="relative flex size-9 shrink-0"
          data-testid="conversation-card-avatar"
          data-kind={row.activityKind}
        >
          {row.activityKind === "direct" && row.senderType ? (
            <AvatarSlot
              context="panel-header"
              type={row.senderType === "agent" ? "agent" : "human"}
            />
          ) : (
            <span className="flex size-9 items-center justify-center rounded-sticker bg-fill-muted text-foreground-muted">
              {row.activityKind === "direct" ? (
                <DirectMessageIcon width={18} height={18} />
              ) : (
                <Hash size={18} />
              )}
            </span>
          )}
          {thread && (
            <span className="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-sticker border border-line-seam bg-layer-card text-foreground-muted">
              <ThreadIcon width={11} height={11} />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1" data-testid="conversation-card-content">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className={`min-w-0 flex-1 truncate text-subhead ${unreadCount > 0 ? "font-bold text-foreground-strong" : "font-semibold text-foreground-muted"}`}
              data-testid="conversation-card-primary"
            >
              {row.label}
            </div>
            <span
              className={`shrink-0 font-mono text-mono-meta leading-5 text-foreground-hint ${timestampVisibilityClassName}`}
              data-testid="conversation-card-timestamp"
            >
              {formatRelativeTime(row.message.createdAt, locale)}
            </span>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <p
              className={`min-w-0 flex-1 truncate text-callout ${unreadCount > 0 ? "text-foreground" : "text-foreground-muted"}`}
              data-testid="conversation-card-body"
            >
              {thread && (
                <span className="mr-1" data-testid="conversation-card-subtitle">
                  #{row.roomName}
                </span>
              )}
              <span className="font-semibold text-foreground">
                {row.senderName}:{" "}
              </span>
              <InlineMarkdownPreview
                markdown={row.message.body || "附件消息"}
              />
            </p>
            {unreadCount > 0 && (
              <SidebarItemCount
                className={`shrink-0 ${timestampVisibilityClassName}`}
                data-testid="conversation-card-new-badge"
              >
                {unreadCount}
              </SidebarItemCount>
            )}
          </div>
        </div>
        {hasRowAction && (
          <div
            className="pointer-events-none absolute top-1/2 right-3 z-10 flex -translate-y-1/2 items-center"
            data-testid="conversation-card-actions"
          >
            <Tooltip content={formatMessage({ id: "thread.row.markAsDone" })}>
              <Button
                variant="outline"
                size="icon-md"
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
                className={`relative z-10 shrink-0 transition-opacity  ${rowActionVisibilityClassName}`}
                aria-label={formatMessage({ id: "thread.row.markAsDone" })}
                data-testid="inbox-row-done"
              >
                <Check />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>
      {menu && (
        <ActivityContextMenu
          client={client}
          onFollow={onFollow}
          target={menu}
          pending={pending}
          onAction={onAction}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
