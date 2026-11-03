import { OfficialMarkedUnread } from "./OfficialContextMenu138.generated.js";
import { useMobileActivitySwipe } from "./MobileActivitySwipe.generated";
import { activityReadToggle } from "./mobile-activity";
import {
  swipeRowClass,
  swipeLayerClass,
  swipeDoneClass,
  swipeSecondaryClass,
  swipeAccessibleActionClass,
} from "./OfficialActivitySwipe.generated";
import type { ActivitySwipeBinding } from "./useActivitySwipe";
import type { ComponentProps } from "react";
import OfficialConversationAvatar from "./OfficialConversationAvatar.generated";
import ActivityContextMenu, {
  type ActivityMenuTarget,
} from "./ActivityContextMenu.tsx";
import type { ActivityAction } from "./activity-actions.ts";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import { useRef, useEffect, useState, useCallback, useId } from "react";
// Compact row composition from v1.21.26; native v1.21.34 touch gesture/recipes
// are an immutable generated dependency. See activity-swipe-manifest.json.
// Loom binds durable activity actions; native recipes own row/action presentation.
import { ACTIVITY_PREVIEW_QUERY } from "./activity-layout.ts";
import { useIntl } from "react-intl";
import {
  InboxItem,
  InboxItemTrigger as InboxItemOpen,
  InboxItemLeading,
  IconTile,
  ThreadIcon,
  TaskStatusBadge,
  InboxItemContent,
  InboxItemHeading,
  InboxItemTitle,
  InboxItemBody,
  InboxItemTrailing,
  InboxItemTimestamp,
  InboxItemMarks,
  InboxItemActions,
  SidebarItemCount,
  Button,
} from "raft-ui";
import { InboxItemLeadingBadge } from "raft-ui/wip";
import {
  Check,
  BellOff,
  BellMinus,
  MessageSquareCheck,
  MessageSquareDot,
  Hash,
} from "lucide-react";
import { taskWorkflowStatus } from "@rah-os/protocol";
import { toRuiTaskStatus } from "../packages/web/src/components/task/taskStatusUi.ts";
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
  swipe,
  onSwipeDone,
  onSwipeMute,
  onSwipeUnfollow,
  muted,
  onMute,
}: {
  muted?: boolean;
  onMute?: ComponentProps<typeof ActivityContextMenu>["onMute"];
  swipe?: ActivitySwipeBinding;
  onSwipeMute?: (row: DiscoveryRow) => void;
  onSwipeUnfollow?: (row: DiscoveryRow) => void;
  onSwipeDone?: (row: DiscoveryRow) => void;
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
  const titleId = useId(),
    bodyId = useId();
  const [menu, setMenu] = useState<ActivityMenuTarget>();
  const closeMenu = useCallback(() => {
    setMenu(undefined);
    root.current
      ?.querySelector<HTMLButtonElement>('[data-testid="inbox-row-open"]')
      ?.focus();
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const activate = (detail: number) => {
    clearTimeout(timer.current);
    if (!window.matchMedia(ACTIVITY_PREVIEW_QUERY).matches || detail >= 2)
      onOpen(true);
    else timer.current = setTimeout(() => onOpen(false), 220);
  };
  const unreadCount = row.unread ?? 0;
  const thread = row.activityKind === "thread";
  const hasRowAction = Boolean(row.activityFrontier);
  const done = () => {
    clearTimeout(timer.current);
    if (!pending) onAction(row, "done");
  };
  const swipeDone = () => {
    clearTimeout(timer.current);
    if (!pending) {
      if (onSwipeDone) onSwipeDone(row);
      else done();
    }
  };
  const swipeEnabled = !!swipe?.enabled && hasRowAction && !pending;
  const readToggle = activityReadToggle(row);
  const swipeRead = () => {
    clearTimeout(timer.current);
    if (!pending && readToggle) onAction(row, readToggle);
  };
  const gesture = useMobileActivitySwipe({
    onStartSwipe: readToggle ? swipeRead : undefined,
    enabled: swipeEnabled,
    actionsWidth: 72 * (1 + Number(!!onSwipeMute) + Number(!!onSwipeUnfollow)),
    open: swipe?.openId === row.id,
    onOpenChange: (open) => swipe?.onOpenChange(row.id, open),
    onFullSwipe: swipeDone,
    shouldYield: () => !!menu,
  });
  const rowRef = useCallback(
    (element: HTMLDivElement | null) => {
      root.current = element;
      gesture.ref(element);
    },
    [gesture.ref],
  );
  return (
    <>
      <InboxItem
        density="compact"
        active={active}
        data-unread={unreadCount > 0 || row.markedUnread || undefined}
        ref={rowRef}
        {...(swipeEnabled ? gesture.handlers : {})}
        className={
          swipeEnabled
            ? `${swipeRowClass} loom-mobile-activity-swipe`
            : undefined
        }
        data-inbox-key={row.id}
        onContextMenu={(event) => {
          event.preventDefault();
          clearTimeout(timer.current);
          if (row.activityFrontier)
            setMenu({ row, x: event.clientX, y: event.clientY });
        }}
        data-result-id={row.id}
        data-testid="inbox-row"
        data-layout="list"
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
        }}
      >
        <InboxItemOpen
          data-testid="inbox-row-open"
          aria-current={active ? "true" : undefined}
          aria-labelledby={`${titleId} ${bodyId}`}
          onClick={(event) => activate(event.detail)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              activate(1);
            }
          }}
        />
        {swipeEnabled && readToggle && (
          <div
            data-row-swipe-layer=""
            aria-hidden="true"
            className={`${swipeLayerClass} loom-start-swipe-actions`}
          >
            <button
              type="button"
              tabIndex={-1}
              data-row-swipe-action="read-toggle"
              data-testid="inbox-row-swipe-read"
              className={swipeSecondaryClass}
              onClick={() => {
                swipe?.onOpenChange(row.id, false);
                swipeRead();
              }}
            >
              {readToggle === "read" ? (
                <MessageSquareCheck />
              ) : (
                <MessageSquareDot />
              )}
              {readToggle === "read" ? "标记已读" : "标记未读"}
            </button>
          </div>
        )}
        {swipeEnabled && (
          <div
            data-row-swipe-layer=""
            aria-hidden="true"
            data-testid="inbox-row-swipe-actions"
            className={swipeLayerClass}
          >
            {onSwipeMute && (
              <button
                type="button"
                tabIndex={-1}
                data-row-swipe-action="mute"
                data-testid="inbox-row-swipe-mute"
                className={swipeSecondaryClass}
                onClick={() => {
                  swipe?.onOpenChange(row.id, false);
                  onSwipeMute(row);
                }}
              >
                <BellOff />
                静音
              </button>
            )}
            {onSwipeUnfollow && (
              <button
                type="button"
                tabIndex={-1}
                data-row-swipe-action="unfollow"
                data-testid="inbox-row-swipe-unfollow"
                className={swipeSecondaryClass}
                onClick={() => {
                  swipe?.onOpenChange(row.id, false);
                  onSwipeUnfollow(row);
                }}
              >
                <BellMinus />
                取消关注
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              data-row-swipe-action="done"
              data-testid="inbox-row-swipe-done"
              className={swipeDoneClass}
              onClick={() => {
                swipe?.onOpenChange(row.id, false);
                swipeDone();
              }}
            >
              <Check />
              完成
            </button>
          </div>
        )}
        <InboxItemLeading>
          {thread ? (
            <>
              <IconTile
                data-testid="conversation-card-avatar"
                data-kind="thread"
              >
                <ThreadIcon />
              </IconTile>
              <InboxItemLeadingBadge data-testid="conversation-card-channel-badge">
                <Hash />
              </InboxItemLeadingBadge>
            </>
          ) : (
            <OfficialConversationAvatar
              kind={
                thread
                  ? "thread"
                  : row.activityKind === "direct"
                    ? "dm"
                    : "channel"
              }
              dmChannel={
                row.activityKind === "direct" && row.senderType
                  ? { peerType: row.senderType === "agent" ? "agent" : "user" }
                  : null
              }
            />
          )}
        </InboxItemLeading>
        <InboxItemContent data-testid="conversation-card-content">
          <InboxItemHeading>
            <InboxItemTitle
              id={titleId}
              data-testid="conversation-card-primary"
            >
              {row.label}
            </InboxItemTitle>
            {row.task && (
              <TaskStatusBadge
                size="sm"
                status={toRuiTaskStatus(taskWorkflowStatus(row.task.state))}
                data-testid="conversation-card-task-badge"
              >
                #{row.task.taskNumber}
              </TaskStatusBadge>
            )}
          </InboxItemHeading>
          <InboxItemBody id={bodyId} data-testid="conversation-card-body">
            {thread && (
              <span className="mr-1" data-testid="conversation-card-subtitle">
                #{row.roomName}
              </span>
            )}
            <span className="font-semibold text-foreground">
              {row.senderName}:{" "}
            </span>
            <InlineMarkdownPreview markdown={row.message.body || "附件消息"} />
          </InboxItemBody>
        </InboxItemContent>
        <InboxItemTrailing>
          <InboxItemTimestamp data-testid="conversation-card-timestamp">
            {formatRelativeTime(row.message.createdAt, locale)}
          </InboxItemTimestamp>
          <InboxItemMarks data-testid="conversation-card-marks">
            {unreadCount > 0 ? (
              <SidebarItemCount data-testid="conversation-card-new-badge">
                {unreadCount}
              </SidebarItemCount>
            ) : row.markedUnread ? (
              <OfficialMarkedUnread
                data-testid="conversation-card-marked-unread"
                aria-label="已标记未读"
              />
            ) : null}
          </InboxItemMarks>
          {hasRowAction && (
            <InboxItemActions
              reveal={swipe?.enabled ? undefined : "hover"}
              className={
                swipe?.enabled ? swipeAccessibleActionClass : undefined
              }
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
                  aria-label={formatMessage({ id: "thread.row.markAsDone" })}
                  data-testid="inbox-row-done"
                >
                  <Check />
                </Button>
              </Tooltip>
            </InboxItemActions>
          )}
        </InboxItemTrailing>
      </InboxItem>
      {menu && (
        <ActivityContextMenu
          client={client}
          onFollow={onFollow}
          target={menu}
          muted={muted}
          onMute={onMute}
          pending={pending}
          onAction={onAction}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
