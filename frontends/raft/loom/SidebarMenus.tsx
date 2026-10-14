import { useRef, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "raft-ui";
import { ArrowUpDown, Check } from "lucide-react";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";

type Item = { label: string; run: () => void; disabled?: boolean };
// Same Raft UI primitives as upstream; Base UI owns dismissal, focus,
// viewport collision avoidance and touch long-press.
export function SidebarContextMenu({
  children,
  items,
  disabled,
  label,
}: {
  children: ReactNode;
  items: Item[];
  disabled?: boolean;
  label: string;
}) {
  const trigger = useRef<HTMLDivElement>(null);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={trigger}
        className="min-w-0 flex-1"
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
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
        {items.map((item) => (
          <ContextMenuItem
            key={item.label}
            disabled={disabled || item.disabled}
            onClick={item.run}
          >
            {item.label}
          </ContextMenuItem>
        ))}
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
            <button
              type="button"
              className="btn-flat-sm flex size-6 items-center justify-center p-0"
              aria-label={`排序 ${name}`}
              disabled={disabled}
            />
          }
        >
          <ArrowUpDown size={14} />
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
