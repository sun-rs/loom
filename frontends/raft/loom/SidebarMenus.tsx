import { Fragment, useRef, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubmenu,
  ContextMenuSubmenuTrigger,
  SidebarSectionControl,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "raft-ui";
import { ArrowUpDown, Check } from "lucide-react";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";

export type SidebarMenuItem = {
  label: string;
  icon?: ReactNode;
  separatorBefore?: boolean;
  run?: () => void;
  disabled?: boolean;
  checked?: boolean;
  children?: SidebarMenuItem[];
};
function MenuItems({
  items,
  disabled,
}: {
  items: SidebarMenuItem[];
  disabled?: boolean;
}) {
  return items.map((item) => (
    <Fragment key={item.label}>
      {item.separatorBefore && <ContextMenuSeparator />}
      {item.children ? (
        <ContextMenuSubmenu>
          <ContextMenuSubmenuTrigger disabled={disabled || item.disabled}>
            {item.icon}
            {item.label}
          </ContextMenuSubmenuTrigger>
          <ContextMenuContent aria-label={item.label}>
            <MenuItems items={item.children} disabled={disabled} />
          </ContextMenuContent>
        </ContextMenuSubmenu>
      ) : (
        <ContextMenuItem
          disabled={disabled || item.disabled}
          onClick={item.run}
        >
          {item.icon}
          {item.label}
          {item.checked && <Check size={14} className="ml-auto" />}
        </ContextMenuItem>
      )}
    </Fragment>
  ));
}
// Same Raft UI primitives as upstream; Base UI owns dismissal, focus,
// viewport collision avoidance and touch long-press.
export function SidebarContextMenu({
  children,
  items,
  disabled,
  label,
  surface = false,
  fillContent = false,
  onOpenChange,
}: {
  children: ReactNode;
  items: SidebarMenuItem[];
  disabled?: boolean;
  label: string;
  surface?: boolean;
  fillContent?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const trigger = useRef<HTMLDivElement>(null);
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger
        ref={trigger}
        className={
          surface
            ? fillContent
              ? "flex min-h-0 min-w-0 flex-1 flex-col"
              : "min-h-full min-w-0"
            : "min-w-0 flex-1"
        }
        data-testid={surface ? "sidebar-surface" : undefined}
        onContextMenu={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          // Native sortable rows listen in the bubble phase. Let the primary
          // mouse/pen press reach them; retain nested-context-menu isolation.
          if (!surface && (event.pointerType === "touch" || event.button !== 0))
            event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            event.currentTarget.dispatchEvent(
              new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                clientX: rect.left + 12,
                clientY: rect.bottom,
              }),
            );
          }
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label={label}
        finalFocus={() => trigger.current?.querySelector("button") ?? false}
      >
        <MenuItems items={items} disabled={disabled} />
      </ContextMenuContent>
    </ContextMenu>
  );
}
export function SidebarSortMenu({
  name,
  value,
  disabled,
  onChange,
}: {
  name: string;
  value: string;
  disabled: boolean;
  onChange: (mode: "manual" | "az" | "recent") => void;
}) {
  return (
    <DropdownMenu>
      <Tooltip content={`排序 ${name}`}>
        <DropdownMenuTrigger
          render={
            <SidebarSectionControl
              type="button"
              aria-label={`排序 ${name}`}
              disabled={disabled}
            />
          }
        >
          <ArrowUpDown size={16} />
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent>
        {(
          [
            ["manual", "手动排序"],
            ["az", "按名称排序"],
            ["recent", "按最近活动排序"],
          ] as const
        ).map(([mode, label]) => (
          <DropdownMenuItem key={mode} onClick={() => onChange(mode)}>
            {label}
            {value === mode && <Check size={14} className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
