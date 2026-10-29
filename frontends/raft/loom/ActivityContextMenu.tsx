// Structural port: v1.21.22 ThreadsInbox je + app-shell t$/R4e.
// Loom owns canonical follow/read outcomes; the menu lazily reads thread authority.
import { useEffect, useRef, useState, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import MenuItem from "../packages/web/src/components/ui/MenuItem";
import { FollowThreadIcon, UnfollowThreadIcon } from "raft-ui";
import { ContextMenuPopup } from "raft-ui";
import {
  Bell,
  BellOff,
  Check,
  MessageSquareCheck,
  MessageSquareDot,
  RefreshCw,
} from "lucide-react";
import DismissBackdrop from "../packages/web/src/components/ui/DismissBackdrop.tsx";
import { placeContextMenu } from "../packages/web/src/components/ui/contextMenuPosition.ts";
import type { DiscoveryRow } from "./discovery-client.ts";
import type { ActivityAction } from "./activity-actions.ts";
import type { RahClient } from "@rah-os/client-sdk";
import { ThreadActivityClient } from "./thread-activity.ts";
export type ActivityMenuTarget = { row: DiscoveryRow; x: number; y: number };
export default function ActivityContextMenu({
  client,
  target,
  pending,
  muted = false,
  onMute,
  onFollow,
  onAction,
  onClose,
}: {
  client: RahClient;
  muted?: boolean;
  onMute?: (row: DiscoveryRow, muted: boolean) => void;
  onFollow: (
    row: DiscoveryRow,
    activity: ThreadActivityClient,
    following: boolean,
  ) => void;
  target: ActivityMenuTarget;
  pending: boolean;
  onAction: (row: DiscoveryRow, action: ActivityAction) => void;
  onClose: () => void;
}) {
  const { formatMessage } = useIntl();
  const root = useRef<HTMLDivElement>(null);
  const threadId = target.row.activityFrontier?.threadId;
  const activity = useMemo(
    () =>
      threadId
        ? new ThreadActivityClient(client, target.row.message.roomId, threadId)
        : undefined,
    [client, target.row.message.roomId, threadId],
  );
  const [following, setFollowing] = useState<boolean>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!activity) return;
    const abort = new AbortController();
    setFollowing(undefined);
    setLoadFailed(false);
    void activity
      .refresh(abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setFollowing(result.following);
      })
      .catch(() => {
        if (!abort.signal.aborted) setLoadFailed(true);
      });
    return () => abort.abort();
  }, [activity, retry]);
  useEffect(() => {
    root.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);
  const [pos, setPos] = useState(() =>
    placeContextMenu({ x: target.x, y: target.y, width: 184, height: 96 }),
  );
  useLayoutEffect(() => {
    // Native ContextMenuPopup has min-w-60 despite the page's width:184.
    // Preserve that recipe and place using actual bounds so mobile edges cannot clip it.
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (rect)
        setPos(
          placeContextMenu({
            x: target.x,
            y: target.y,
            width: rect.width,
            height: rect.height,
          }),
        );
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [target, following, loadFailed]);
  const unread =
    (target.row.unread ?? 0) > 0 || target.row.markedUnread === true;
  const actions: ActivityAction[] =
    target.row.activityKind === "thread" && following !== true
      ? ["done"]
      : [unread ? "read" : "unread", "done"];
  return (
    <>
      <DismissBackdrop onDismiss={onClose} trapContextMenu />
      {createPortal(
        <ContextMenuPopup
          ref={root}
          role="menu"
          aria-label="动态操作"
          className="fixed z-[60] overflow-y-auto overflow-x-hidden select-none"
          style={{
            left: pos.x,
            top: pos.y,
            width: 184,
            maxWidth: pos.maxWidth,
            maxHeight: pos.maxHeight,
          }}
          data-testid="activity-context-menu"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const buttons = Array.from(
              root.current?.querySelectorAll<HTMLButtonElement>(
                "button:not(:disabled)",
              ) ?? [],
            );
            const index = buttons.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            buttons[
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? buttons.length - 1
                  : (index + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                    buttons.length
            ]?.focus();
          }}
        >
          {actions.map((action) => (
            <MenuItem
              key={action}
              disabled={pending}
              icon={
                action === "done" ? (
                  <Check size={14} />
                ) : action === "read" ? (
                  <MessageSquareCheck size={14} />
                ) : (
                  <MessageSquareDot size={14} />
                )
              }
              onClick={() => {
                onAction(target.row, action);
                onClose();
              }}
            >
              {formatMessage({
                id:
                  action === "done"
                    ? "thread.row.markAsDone"
                    : action === "read"
                      ? "thread.contextMenu.markAsRead"
                      : "thread.contextMenu.markAsUnread",
              })}
            </MenuItem>
          ))}
          {activity && (
            <MenuItem
              disabled={pending || (following === undefined && !loadFailed)}
              icon={
                following === undefined ? (
                  <RefreshCw size={14} />
                ) : following ? (
                  <UnfollowThreadIcon width={14} height={14} />
                ) : (
                  <FollowThreadIcon width={14} height={14} />
                )
              }
              onClick={() => {
                if (following === undefined) {
                  setRetry((v) => v + 1);
                  return;
                }
                onFollow(target.row, activity, !following);
                onClose();
              }}
            >
              {following === undefined
                ? loadFailed
                  ? "重新读取关注状态"
                  : "读取关注状态…"
                : formatMessage({
                    id: following
                      ? "thread.contextMenu.unfollow"
                      : "thread.contextMenu.follow",
                  })}
            </MenuItem>
          )}
          {onMute && target.row.activityKind === "channel" && (
            <MenuItem
              disabled={pending}
              icon={muted ? <Bell size={14} /> : <BellOff size={14} />}
              onClick={() => {
                onMute(target.row, !muted);
                onClose();
              }}
            >
              {muted ? "取消静音活动" : "静音活动"}
            </MenuItem>
          )}
        </ContextMenuPopup>,
        document.body,
      )}
    </>
  );
}
