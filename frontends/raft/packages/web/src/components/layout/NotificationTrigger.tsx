// v1.21.22 R6/Yst structural port; Loom notification entries retain their write owner.
import { forwardRef, useCallback, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { Bell } from "lucide-react";
import { useIntl } from "react-intl";
import {
  AppRailItemAttention,
  NotificationCenter,
  PopoverTrigger,
  Status,
} from "raft-ui";
import ConnectedNotificationCenter from "./NotificationCenter";
import Tooltip from "../ui/Tooltip";
import type { NotificationEntry } from "./useSystemNotifications";

const MOBILE_TOOLTIP_CONTENT_PROPS = { side: "bottom" } as const;

export interface NotificationTriggerProps {
  flavor: "rail-bottom" | "mobile-navbar" | "top-bar";
  notifications?: NotificationEntry[];
}

export default function NotificationTrigger({
  flavor,
  notifications: notificationsProp,
}: NotificationTriggerProps) {
  // Loom owns notification collection; the official view is controlled by entries.
  const notifications = notificationsProp ?? [];
  const [open, setOpen] = useState(false);
  const { formatMessage } = useIntl();
  const unreadCount = notifications.filter(
    (notification) => notification.unread !== false,
  ).length;
  const hasUnread = unreadCount > 0;
  const ariaLabel = hasUnread
    ? formatMessage(
        { id: "layout.notifications.centerActiveAria" },
        { count: unreadCount },
      )
    : formatMessage({ id: "layout.notifications.centerAria" });
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        for (const notification of notifications) {
          if (notification.unread !== false) notification.onSeen?.();
        }
      }
    },
    [notifications],
  );

  const button = (
    <NotificationTriggerButton
      open={open}
      hasUnread={hasUnread}
      ariaLabel={ariaLabel}
      testId={
        flavor === "rail-bottom"
          ? "notification-trigger-rail"
          : flavor === "top-bar"
            ? "notification-trigger-top-bar"
            : "notification-trigger-mobile"
      }
      flavor={flavor}
      sizeClass={
        flavor === "mobile-navbar"
          ? "size-11"
          : flavor === "top-bar"
            ? "size-9"
            : "size-10 [@media(max-height:600px)]:size-9"
      }
      icon={
        <Bell
          aria-hidden="true"
          className={flavor === "mobile-navbar" ? "size-[22px]" : "size-5"}
        />
      }
    />
  );

  return (
    <NotificationCenter open={open} onOpenChange={handleOpenChange}>
      <div
        className={`relative ${flavor === "rail-bottom" ? "flex w-full justify-center" : "shrink-0"}`}
      >
        {flavor !== "rail-bottom" ? (
          <Tooltip
            content={formatMessage({
              id: "layout.notifications.centerTooltip",
            })}
            contentProps={MOBILE_TOOLTIP_CONTENT_PROPS}
          >
            <PopoverTrigger render={button} />
          </Tooltip>
        ) : (
          // The generic raft-ui trigger keeps the rail-owned 40px Bell visual;
          // NotificationCenterTrigger is a complete orange button recipe.
          <PopoverTrigger
            openOnHover
            delay={0}
            closeDelay={120}
            render={button}
          />
        )}
        <ConnectedNotificationCenter
          notifications={notifications}
          flavor={
            flavor === "rail-bottom"
              ? "desktop"
              : flavor === "top-bar"
                ? "top-bar"
                : "mobile"
          }
        />
      </div>
    </NotificationCenter>
  );
}

type NotificationTriggerButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "children"
> & {
  open: boolean;
  hasUnread: boolean;
  ariaLabel: string;
  testId: string;
  flavor: "rail-bottom" | "mobile-navbar" | "top-bar";
  sizeClass: string;
  icon: ReactNode;
};

const NotificationTriggerButton = forwardRef<
  HTMLButtonElement,
  NotificationTriggerButtonProps
>(function NotificationTriggerButton(
  {
    open,
    hasUnread,
    ariaLabel,
    testId,
    flavor,
    sizeClass,
    icon,
    className = "",
    ...buttonProps
  },
  ref,
) {
  return (
    <button
      {...buttonProps}
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      data-state={open ? "open" : "closed"}
      data-has-unread={hasUnread ? "true" : "false"}
      data-testid={testId}
      className={`group relative inline-flex ${sizeClass} items-center justify-center rounded-control border-[1.5px] outline-none transition-colors focus-visible:shadow-raft-focus ${open ? "border-line-frame-active bg-layer-frame-active text-foreground-on-frame-active" : "border-transparent text-foreground-on-frame hover:bg-fill-frame-pressed active:bg-fill-frame-pressed"} ${className}`}
    >
      <span className="relative inline-flex items-center justify-center">
        {icon}
        {hasUnread ? (
          flavor === "rail-bottom" ? (
            // task #720: the rail Bell's unread dot rides the SAME composite
            // every other rail item uses (AppRailItemAttention = attention
            // mask + indicator + sr-only title) instead of a one-off Status
            // dot with a hand-set offset — same size, same position, same
            // theme mapping, same AT announcement, and it tracks future rail
            // recipe changes automatically.
            <AppRailItemAttention title={ariaLabel} />
          ) : (
            <Status
              aria-hidden
              size="md"
              variant={"accent"}
              className="pointer-events-none absolute -top-1 -end-1"
              data-testid={`${testId}-unread-dot`}
            />
          )
        ) : null}
      </span>
    </button>
  );
});
