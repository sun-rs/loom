import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icon.tsx";

export type DiscoveryOption = {
  id: string;
  label: string;
  leading?: ReactNode;
  italic?: boolean;
  disabledReason?: string;
};

/** Raft Zd/V9e selection popup. Portal positioning and keyboard roles adapt it to
 * our bounded scrolling shells; row geometry and selection behavior are upstream. */
export function DiscoveryFilter({
  label,
  icon = "user-round",
  options,
  values,
  onChange,
  multiple = true,
  searchable = true,
  clearable = true,
  disabled = false,
  triggerLabel = label,
  showCount = multiple,
  selected = values.length > 0,
  className = "",
  variant = "selection",
}: {
  label: string;
  icon?: string | null;
  options: readonly DiscoveryOption[];
  values: string[];
  onChange: (values: string[]) => void;
  multiple?: boolean;
  searchable?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  triggerLabel?: string;
  showCount?: boolean;
  selected?: boolean;
  className?: string;
  variant?: "selection" | "status";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const visible = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const close = (restore = false) => {
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!menu.current || !trigger.current) return;
      const origin = trigger.current.getBoundingClientRect(),
        popup = menu.current.getBoundingClientRect();
      const gutter = variant === "status" ? 8 : 12,
        gap = variant === "status" ? 4 : 8;
      const anchor =
        variant === "status" && window.innerWidth < 640
          ? origin.right - popup.width
          : origin.left;
      const left = Math.max(
        gutter,
        Math.min(anchor, window.innerWidth - popup.width - gutter),
      );
      const top =
        origin.bottom + gap + popup.height <= window.innerHeight - gutter
          ? origin.bottom + gap
          : Math.max(gutter, origin.top - popup.height - gap);
      Object.assign(menu.current.style, { left: `${left}px`, top: `${top}px` });
    };
    place();
    if (searchable)
      menu.current?.querySelector<HTMLInputElement>("input")?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, searchable, variant]);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        close(true);
      }
    };
    const outside = (event: Event) => {
      if (
        !root.current?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        close();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("focusin", outside);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("focusin", outside);
    };
  }, [open]);
  function choose(value: string) {
    onChange(
      multiple
        ? values.includes(value)
          ? values.filter((id) => id !== value)
          : [...values, value]
        : [value],
    );
    if (!multiple) close(true);
  }
  return (
    <div
      className={`task-filter rah-discovery-filter${selected ? " is-selected" : ""} ${className}`}
      ref={root}
    >
      <button
        ref={trigger}
        type="button"
        className="task-filter-trigger"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? id : undefined}
        onKeyDown={(event) => {
          if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            const items = menu.current?.querySelectorAll<HTMLButtonElement>(
              '[role^="menuitem"]:not(:disabled)',
            );
            items?.[event.key === "ArrowDown" ? 0 : items.length - 1]?.focus();
          }
        }}
        onClick={() => {
          setOpen(!open);
          setQuery("");
        }}
      >
        {icon && <Icon name={icon} />}
        {triggerLabel}
        {showCount && values.length > 0 && (
          <span className="task-filter-count">{values.length}</span>
        )}
        <Icon name="chevron-down" />
      </button>
      {open &&
        createPortal(
          <div
            className={`rah-discovery-popover${variant === "status" ? " is-status" : ""}`}
            ref={menu}
            id={id}
            role="menu"
            aria-label={`${label}筛选`}
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
                if (
                  (event.key === "Home" || event.key === "End") &&
                  event.target instanceof HTMLInputElement
                )
                  return;
                event.preventDefault();
                const items = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[role^="menuitem"]:not(:disabled)',
                  ),
                ];
                const current = items.findIndex(
                  (item) => item === document.activeElement,
                );
                const index =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? items.length - 1
                      : current < 0
                        ? event.key === "ArrowDown"
                          ? 0
                          : items.length - 1
                        : (current +
                            (event.key === "ArrowDown" ? 1 : -1) +
                            items.length) %
                          items.length;
                items[index]?.focus();
              } else if (
                event.key === "Enter" &&
                event.target instanceof HTMLInputElement &&
                !event.nativeEvent.isComposing
              ) {
                const first = visible.find((option) => !option.disabledReason);
                if (first) {
                  event.preventDefault();
                  choose(first.id);
                }
              }
            }}
          >
            {variant !== "status" && (
              <header>
                <b>{label}</b>
                {clearable && values.length > 0 && (
                  <button type="button" onClick={() => onChange([])}>
                    清除
                  </button>
                )}
              </header>
            )}
            {searchable && (
              <div className="rah-discovery-popover-search">
                <input
                  aria-label={`搜索${label}`}
                  placeholder="搜索…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            )}
            <div className="rah-discovery-popover-options">
              {visible.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  role={multiple ? "menuitemcheckbox" : "menuitemradio"}
                  aria-checked={values.includes(option.id)}
                  disabled={Boolean(option.disabledReason)}
                  title={option.disabledReason}
                  onClick={() => choose(option.id)}
                >
                  {option.leading && (
                    <span className="rah-discovery-option-leading">
                      {option.leading}
                    </span>
                  )}
                  <span className={option.italic ? "is-italic" : ""}>
                    {option.label}
                  </span>
                  {values.includes(option.id) && <Icon name="check" />}
                </button>
              ))}
              {!visible.length && <p>没有匹配项</p>}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
