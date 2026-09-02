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

export const REACTION_HOVER_CLOSE_MS = 120;

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
  triggerAriaLabel,
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
  triggerAriaLabel?: string;
  showCount?: boolean;
  selected?: boolean;
  className?: string;
  variant?: "selection" | "status" | "reaction" | "sidebar";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const hoverCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const visible = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const cancelHoverClose = () => {
    if (hoverCloseTimer.current !== null) {
      clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  };
  const close = (restore = false) => {
    cancelHoverClose();
    setOpen(false);
    if (restore) trigger.current?.focus();
  };
  const containsReactionTarget = (target: EventTarget | null) =>
    target instanceof Node &&
    (root.current?.contains(target) || menu.current?.contains(target));
  const scheduleHoverClose = (relatedTarget: EventTarget | null) => {
    if (variant !== "reaction" || containsReactionTarget(relatedTarget)) return;
    cancelHoverClose();
    hoverCloseTimer.current = setTimeout(
      () => close(),
      REACTION_HOVER_CLOSE_MS,
    );
  };
  useEffect(() => cancelHoverClose, []);
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
    const viewportChanged = () => {
      if (variant === "reaction") close();
      else place();
    };
    window.addEventListener("resize", viewportChanged);
    window.addEventListener("scroll", viewportChanged, true);
    return () => {
      window.removeEventListener("resize", viewportChanged);
      window.removeEventListener("scroll", viewportChanged, true);
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
      onMouseEnter={variant === "reaction" ? cancelHoverClose : undefined}
      onMouseLeave={
        variant === "reaction"
          ? (event) => scheduleHoverClose(event.relatedTarget)
          : undefined
      }
    >
      <button
        ref={trigger}
        type="button"
        className={`task-filter-trigger${
          variant === "sidebar" ? " rah-interaction-flat" : ""
        }`}
        aria-label={triggerAriaLabel}
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
            className={`rah-discovery-popover is-${variant}`}
            ref={menu}
            id={id}
            role="menu"
            aria-label={`${label}筛选`}
            onMouseEnter={variant === "reaction" ? cancelHoverClose : undefined}
            onMouseLeave={
              variant === "reaction"
                ? (event) => scheduleHoverClose(event.relatedTarget)
                : undefined
            }
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
            {variant === "selection" && (
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
                  title={
                    option.disabledReason ??
                    (variant === "reaction" ? option.label : undefined)
                  }
                  aria-label={variant === "reaction" ? option.label : undefined}
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
