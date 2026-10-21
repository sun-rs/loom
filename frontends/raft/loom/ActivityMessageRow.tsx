import type { ComponentProps } from "react";
import OfficialConversationAvatar from "./OfficialConversationAvatar.generated";
import ActivityContextMenu, {
  type ActivityMenuTarget,
} from "./ActivityContextMenu.tsx";
import type { ActivityAction } from "./activity-actions.ts";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import { useRef, useEffect, useState, useCallback, useId } from "react";
// Structural port of v1.21.26 ThreadsInbox-vmpxj7RN.js compact InboxItem branch.
// Loom binds durable activity actions; native recipes own row/action presentation.
import { ACTIVITY_PREVIEW_QUERY } from "./activity-layout.ts";
import { useIntl } from "react-intl";
import {
  InboxItem,
  InboxItemTrigger as InboxItemOpen,
  InboxItemLeading,
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
import { Check } from "lucide-react";
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
  return (
    <>
      <InboxItem
        density="compact"
        active={active}
        data-unread={unreadCount > 0 || undefined}
        ref={root}
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
        <InboxItemLeading>
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
        </InboxItemLeading>
        <InboxItemContent data-testid="conversation-card-content">
          <InboxItemHeading>
            <InboxItemTitle
              id={titleId}
              data-testid="conversation-card-primary"
            >
              {row.label}
            </InboxItemTitle>
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
            {unreadCount > 0 && (
              <SidebarItemCount data-testid="conversation-card-new-badge">
                {unreadCount}
              </SidebarItemCount>
            )}
          </InboxItemMarks>
          {hasRowAction && (
            <InboxItemActions
              reveal="hover"
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
          pending={pending}
          onAction={onAction}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
