import {
  useRef,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export function NeoButton(props: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "default" | "pink" | "yellow" | "danger";
}) {
  const { tone = "default", className = "", ...buttonProps } = props;
  return <button {...buttonProps} className={`room-neo-button room-neo-button--${tone} ${className}`} />;
}

export function NeoTabs<T extends string>(props: {
  value: T;
  items: ReadonlyArray<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (value: T) => void;
  label: string;
}) {
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const count = props.items.length;
    if (count === 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % count;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + count) % count;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = count - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = props.items[nextIndex];
    if (!next) return;
    props.onChange(next.value);
    tabs.current[nextIndex]?.focus();
  };
  return (
    <div className="room-neo-tabs" role="tablist" aria-label={props.label}>
      {props.items.map((item, index) => {
        const selected = props.value === item.value;
        return (
          <button
            key={item.value}
            ref={(node) => { tabs.current[index] = node; }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className="room-neo-tab"
            onClick={() => props.onChange(item.value)}
            onKeyDown={(event) => moveFocus(event, index)}
          >
            {item.icon}<span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function NeoEmptyState(props: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="room-neo-empty" role="status">
      <span className="room-neo-empty__icon" aria-hidden="true">{props.icon}</span>
      <strong>{props.title}</strong>
      <span>{props.description}</span>
    </div>
  );
}

export function PresenceDot(props: { state: "working" | "online" | "offline"; label: string }) {
  return <span className={`room-presence-dot room-presence-dot--${props.state}`} title={props.label} aria-label={props.label} />;
}
