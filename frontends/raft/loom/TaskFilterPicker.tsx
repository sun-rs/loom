// Structural port: Raft v1.21.22 app-shell XSt + n8/rlt/tlt. Loom supplies IDs/data only.
import { useRef, useState, type ReactNode } from "react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PickerTriggerButton,
} from "raft-ui";
import { Check, ChevronDown, Search } from "lucide-react";
export type TaskFilterOption = {
  key: string;
  label: string;
  handle?: string;
  sentinel?: boolean;
  avatar?: ReactNode;
};
export default function TaskFilterPicker({
  label,
  icon,
  options,
  selected,
  onChange,
  disabled = false,
  open,
  onOpenChange,
  reserveLeadingSlot = false,
}: {
  label: string;
  icon: ReactNode;
  options: TaskFilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reserveLeadingSlot?: boolean;
}) {
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const filtered = options.filter((o) =>
    `${o.label} ${o.handle ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (value) setSearch("");
        onOpenChange(value);
      }}
    >
      <PopoverTrigger
        render={
          <PickerTriggerButton
            type="button"
            disabled={disabled}
            aria-label={`筛选${label}`}
            data-has-value={selected.length ? "" : undefined}
          />
        }
      >
        {icon}
        {label}
        {selected.length > 0 && (
          <span className="font-mono text-mono-meta font-bold">
            {selected.length}
          </span>
        )}
        <span data-picker-trigger-indicator="" aria-hidden="true">
          <ChevronDown />
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={8}
        initialFocus={input}
        className="flex max-w-(--available-width) flex-col"
        data-testid={`task-filter-${label}`}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-2.5 pb-1">
          <span className="text-caption font-bold text-foreground-hint">
            {label}
          </span>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="rounded-[2px] text-caption font-semibold text-foreground underline decoration-[1.5px] underline-offset-[3px] outline-none focus-visible:shadow-raft-focus"
            >
              清除
            </button>
          )}
        </div>
        <label className="flex h-10 shrink-0 items-center gap-2 border-b border-line-muted px-3 text-foreground-hint focus-within:shadow-[inset_0_0_0_2px_var(--foreground)]">
          <Search size={16} className="shrink-0" aria-hidden="true" />
          <input
            ref={input}
            type="text"
            aria-label={`搜索${label}`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") e.stopPropagation();
            }}
            placeholder={`搜索${label}`}
            className="h-full min-w-0 flex-1 bg-transparent text-callout text-foreground outline-none placeholder:text-foreground-placeholder"
          />
        </label>
        <div className="max-h-64 min-h-0 overflow-y-auto p-1.5">
          {!filtered.length && (
            <div className="px-2.5 py-2 text-callout text-foreground-hint">
              无匹配项
            </div>
          )}
          {filtered.map((o) => (
            <button
              key={o.key}
              type="button"
              aria-pressed={selected.includes(o.key)}
              onClick={() =>
                onChange(
                  selected.includes(o.key)
                    ? selected.filter((v) => v !== o.key)
                    : [...selected, o.key],
                )
              }
              className={`flex h-9 w-full items-center justify-between gap-2 overflow-hidden rounded-control px-2.5 text-left text-callout outline-none text-foreground hover:bg-primary-soft focus-visible:bg-primary-soft${selected.includes(o.key) ? " font-bold" : " font-medium"}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                {(reserveLeadingSlot || o.avatar) && (
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    {o.avatar}
                  </span>
                )}
                <span
                  className={
                    o.sentinel
                      ? "whitespace-nowrap text-foreground-muted"
                      : "truncate"
                  }
                >
                  {o.label}
                </span>
              </span>
              {selected.includes(o.key) && (
                <Check
                  size={16}
                  className="shrink-0 text-foreground"
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
