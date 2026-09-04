import { useRef } from "react";
import { Icon } from "./icon.tsx";

export type PanelTab<Id extends string> = {
  id: Id;
  icon: string;
  label: string;
  disabled?: boolean;
};

// Controlled selection: no route, capability, API or loading state is owned here.
// Raft's TabList contract: loop focus, Home/End and disabledIndices. Automatic
// activation preserves RAH's existing Agent tabs; both consumers now share it.
export function PanelTabs<Id extends string>({
  label,
  items,
  value,
  onSelect,
  className = "",
  listClassName = "",
}: {
  label: string;
  items: readonly PanelTab<Id>[];
  value: Id;
  onSelect: (value: Id) => void;
  className?: string;
  listClassName?: string;
}) {
  const buttons = useRef(new Map<Id, HTMLButtonElement>());
  const enabled = items.filter((item) => !item.disabled);
  const tabStop = enabled.find((item) => item.id === value) ?? enabled[0];
  const reveal = (button: HTMLButtonElement) => {
    // Scroll only this tab viewport: scrollIntoView can move the entire chat.
    const viewport = button.closest<HTMLElement>(".rah-panel-tabs");
    if (!viewport) return;
    const frame = viewport.getBoundingClientRect();
    const tab = button.getBoundingClientRect();
    if (tab.left < frame.left) viewport.scrollLeft -= frame.left - tab.left;
    else if (tab.right > frame.right)
      viewport.scrollLeft += tab.right - frame.right;
  };
  return (
    <div className={`rah-panel-tabs ${className}`.trim()}>
      <div
        aria-label={label}
        className={`rah-panel-tabs-list ${listClassName}`.trim()}
        role="tablist"
      >
        {items.map((item) => (
          <button
            aria-selected={value === item.id}
            className={`tab${value === item.id ? " is-active" : ""}`}
            disabled={item.disabled}
            key={item.id}
            onClick={() => onSelect(item.id)}
            onFocus={(event) => reveal(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              const index = enabled.findIndex((entry) => entry.id === item.id);
              if (index < 0) return;
              const nextIndex =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? enabled.length - 1
                    : event.key === "ArrowRight"
                      ? (index + 1) % enabled.length
                      : event.key === "ArrowLeft"
                        ? (index - 1 + enabled.length) % enabled.length
                        : undefined;
              if (nextIndex === undefined) return;
              event.preventDefault();
              const next = enabled[nextIndex]!;
              buttons.current.get(next.id)?.focus({ preventScroll: true });
              if (next.id !== value) onSelect(next.id);
            }}
            ref={(element) => {
              if (element) buttons.current.set(item.id, element);
              else buttons.current.delete(item.id);
            }}
            role="tab"
            tabIndex={tabStop?.id === item.id ? 0 : -1}
            type="button"
          >
            <Icon name={item.icon} />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
