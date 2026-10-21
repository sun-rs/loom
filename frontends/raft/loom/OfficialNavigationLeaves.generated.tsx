// GENERATED: unchanged declarations from locked Raft db5e399. Only imports are scoped to presentation dependencies.
import {forwardRef,useCallback} from "react";
import type * as React from "react";
import {useIntl} from "react-intl";
import {AppRailItem,AppRailItemIcon,AppRailItemAttention,AppRailItemLabel,SidebarItemMeta,Badge} from "raft-ui";
import Tooltip from "@loom/raft-web-source/Tooltip";
const TOOLTIP_CONTENT_PROPS = {
  left: { side: "left" },
  right: { side: "right" },
} as const;

type RailTabButtonProps = Omit<
  React.ComponentPropsWithoutRef<"button">,
  "children" | "onClick" | "onDoubleClick" | "aria-label" | "aria-haspopup" | "aria-expanded"
> & {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  showDot?: boolean;
  dotInactiveOnly?: boolean;
  dotTooltip?: string;
  tooltipSide?: "left" | "right";
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  testId?: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
  ariaHasPopup?: "menu";
  ariaExpanded?: boolean;
  showTooltip?: boolean;
};

export const RailTabButton = forwardRef<HTMLButtonElement, RailTabButtonProps>(function RailTabButton({
  icon,
  label,
  active,
  showDot,
  dotInactiveOnly,
  dotTooltip,
  tooltipSide = "right",
  onClick,
  onDoubleClick,
  testId,
  onPointerDown,
  buttonRef,
  ariaHasPopup,
  ariaExpanded,
  showTooltip = true,
  className = "",
  ...buttonProps
}, forwardedRef) {
  const dotVisible = Boolean(showDot && (!dotInactiveOnly || !active));
  const setButtonRefs = useCallback((node: HTMLButtonElement | null) => {
    setReactRef(buttonRef, node);
    setReactRef(forwardedRef, node);
  }, [buttonRef, forwardedRef]);
  const button = (
    <AppRailItem
      {...buttonProps}
      ref={setButtonRefs}
      selected={active}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-label={label}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded}
      data-testid={testId}
      onPointerDown={onPointerDown}
      // Raft Design System › Rail: 40×40 items, 36×36 when the window is
      // under 600 tall (the heads shrink to 48 with them).
      className={`size-10 [@media(max-height:600px)]:h-9 [@media(max-height:600px)]:w-9 ${className}`}
    >
      <AppRailItemIcon className="relative">
        {icon}
        {dotVisible ? (
          <AppRailItemAttention title={dotTooltip ?? label} />
        ) : null}
      </AppRailItemIcon>
      <AppRailItemLabel>{label}</AppRailItemLabel>
    </AppRailItem>
  );

  return showTooltip ? (
    <Tooltip
      content={dotVisible && dotTooltip ? dotTooltip : label}
      contentProps={TOOLTIP_CONTENT_PROPS[tooltipSide]}
    >
      {button}
    </Tooltip>
  ) : button;
});

function setReactRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else ref.current = value;
}

const SIDEBAR_ROW_PHONE_CLASS = "max-md:h-auto max-md:min-h-11 max-md:py-[8.5px] max-md:text-body max-md:font-semibold";

export function SavedNavCount({ total }: { total: number }) {
  const { formatMessage } = useIntl();
  if (total <= 0) return null;
  return (
    // `.rf-count`: a grey Space Mono number, not a badge — nothing is waiting.
    <SidebarItemMeta>
      {formatMessage({ id: "layout.sidebar.savedCount" }, { count: total })}
    </SidebarItemMeta>
  );
}

export function sidebarItemClass(selected: boolean, menuOpen = false) {
  return `w-full ${!selected && menuOpen ? "bg-fill-pressed" : ""} ${SIDEBAR_ROW_PHONE_CLASS}`;
}

export function JointPeerBadge({ label }: { label: string }) {
  return (
    <Badge
      appearance="soft"
      variant="information"
      className="inline-flex max-w-full items-center justify-center truncate text-center font-mono text-mono-meta font-normal"
    >
      {label}
    </Badge>
  );
}
