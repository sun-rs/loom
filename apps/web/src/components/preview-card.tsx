import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  RAFT_AVATAR_PREVIEW,
  placePreview,
} from "../agent-trigger-contract.ts";

/** Shared hover lifetime; render-function content can expose a navigation action. */
export function PreviewCard({
  label,
  onClick,
  children,
  content,
  triggerClassName,
  className,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  content: ReactNode | ((close: () => void) => ReactNode);
  triggerClassName?: string;
  className?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null),
    card = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [phase, setPhase] = useState<"closed" | "pending" | "open">("closed"),
    id = useId();
  const open = phase === "open";
  const interactive = typeof content === "function";
  const cancel = () => clearTimeout(timer.current);
  const close = () => {
    cancel();
    setPhase("closed");
  };
  const enter = () => {
    cancel();
    if (open) return;
    setPhase("pending");
    timer.current = setTimeout(
      () => setPhase("open"),
      RAFT_AVATAR_PREVIEW.delay,
    );
  };
  const leave = () => {
    cancel();
    if (!open) {
      setPhase("closed");
      return;
    }
    timer.current = setTimeout(() => {
      if (!card.current?.contains(document.activeElement)) setPhase("closed");
    }, RAFT_AVATAR_PREVIEW.closeDelay);
  };
  useEffect(() => cancel, []);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!trigger.current || !card.current) return;
      const position = placePreview(
        trigger.current.getBoundingClientRect(),
        card.current.getBoundingClientRect(),
        { width: innerWidth, height: innerHeight },
      );
      Object.assign(card.current.style, {
        left: `${position.left}px`,
        top: `${position.top}px`,
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (card.current) observer.observe(card.current);
    // Virtualized messages may adjust their scroll offset after async Markdown
    // measurement. That is not pointer leave; track the anchor instead.
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (phase === "closed") return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (card.current?.contains(document.activeElement))
          trigger.current?.focus();
        close();
      }
    };
    const outside = (event: Event) => {
      if (
        !card.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        close();
    };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [phase]);
  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        ref={trigger}
        aria-label={label}
        aria-describedby={open && !interactive ? id : undefined}
        aria-controls={open && interactive ? id : undefined}
        aria-expanded={interactive ? open : undefined}
        onKeyDown={(event) => {
          if (interactive && open && event.key === "Tab" && !event.shiftKey) {
            const action =
              card.current?.querySelector<HTMLButtonElement>("button");
            if (action) {
              event.preventDefault();
              action.focus();
            }
          }
        }}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
        onClick={
          onClick
            ? () => {
                close();
                onClick();
              }
            : undefined
        }
      >
        {children}
      </button>
      {open &&
        createPortal(
          <aside
            id={id}
            role={interactive ? "dialog" : "tooltip"}
            aria-label={interactive ? label : undefined}
            ref={card}
            className={`rah-preview-card ${className ?? ""}`.trim()}
            style={{
              position: "fixed",
              width: RAFT_AVATAR_PREVIEW.width,
              maxWidth: "calc(100vw - 12px)",
              maxHeight: "calc(100vh - 12px)",
              overflow: "auto",
            }}
            onFocus={cancel}
            onBlur={leave}
            onMouseEnter={cancel}
            onMouseLeave={leave}
          >
            {typeof content === "function" ? content(close) : content}
          </aside>,
          document.body,
        )}
    </>
  );
}
