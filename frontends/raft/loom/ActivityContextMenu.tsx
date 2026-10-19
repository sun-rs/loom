// Structural port: v1.21.22 ThreadsInbox je + app-shell t$/R4e.
// Only supported read/done actions are retained. Loom owns canonical mutation outcomes.
import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { ContextMenuPopup } from "raft-ui";
import { Check, MessageSquareCheck, MessageSquareDot } from "lucide-react";
import DismissBackdrop from "../packages/web/src/components/ui/DismissBackdrop.tsx";
import { placeContextMenu } from "../packages/web/src/components/ui/contextMenuPosition.ts";
import type { DiscoveryRow } from "./discovery-client.ts";
import type { ActivityAction } from "./activity-actions.ts";
export type ActivityMenuTarget = { row: DiscoveryRow; x: number; y: number };
const itemClass =
  "flex min-h-9 w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left [@media(max-height:600px)]:min-h-8 [@media(max-height:600px)]:py-1 font-sans text-callout font-medium text-foreground outline-none transition-colors enabled:hover:bg-primary-soft enabled:focus-visible:bg-primary-soft [&>svg]:shrink-0 [&>svg:first-child]:text-foreground-icon disabled:cursor-not-allowed disabled:text-foreground-disabled disabled:[&>svg:first-child]:text-foreground-disabled";
export default function ActivityContextMenu({
  target,
  pending,
  onAction,
  onClose,
}: {
  target: ActivityMenuTarget;
  pending: boolean;
  onAction: (row: DiscoveryRow, action: ActivityAction) => void;
  onClose: () => void;
}) {
  const { formatMessage } = useIntl();
  const root = useRef<HTMLDivElement>(null);
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
  }, [target]);
  const unread = (target.row.unread ?? 0) > 0;
  // The current activity projection does not expose thread follow state. Upstream
  // hides read actions for unfollowed threads; retain Done only until that state is bound.
  const actions: ActivityAction[] =
    target.row.activityKind === "thread"
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
            if (!["ArrowDown", "ArrowUp"].includes(e.key)) return;
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
              (index + (e.key === "ArrowDown" ? 1 : buttons.length - 1)) %
                buttons.length
            ]?.focus();
          }}
        >
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              data-slot="menu-item"
              className={itemClass}
              disabled={pending}
              onClick={() => {
                onAction(target.row, action);
                onClose();
              }}
            >
              {action === "done" ? (
                <Check size={14} />
              ) : action === "read" ? (
                <MessageSquareCheck size={14} />
              ) : (
                <MessageSquareDot size={14} />
              )}
              <span className="min-w-0 flex-1 truncate">
                {formatMessage({
                  id:
                    action === "done"
                      ? "thread.contextMenu.done"
                      : action === "read"
                        ? "thread.contextMenu.markAsRead"
                        : "thread.contextMenu.markAsUnread",
                })}
              </span>
            </button>
          ))}
        </ContextMenuPopup>,
        document.body,
      )}
    </>
  );
}
