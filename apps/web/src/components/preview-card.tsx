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

/** Noninteractive preview only. Menus use menu keyboard behavior; dialogs use useDialogProtocol. */
export function PreviewCard({
  label,
  onClick,
  children,
  content,
  triggerClassName,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  content: ReactNode;
  triggerClassName?: string;
  className?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null),
    card = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false),
    id = useId();
  const cancel = () => clearTimeout(timer.current);
  const close = () => {
    cancel();
    setOpen(false);
  };
  const enter = () => {
    cancel();
    timer.current = setTimeout(() => setOpen(true), RAFT_AVATAR_PREVIEW.delay);
  };
  const leave = () => {
    cancel();
    timer.current = setTimeout(
      () => setOpen(false),
      RAFT_AVATAR_PREVIEW.closeDelay,
    );
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
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
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
  }, [open]);
  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        ref={trigger}
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocus={enter}
        onBlur={leave}
        onClick={() => {
          close();
          onClick();
        }}
      >
        {children}
      </button>
      {open &&
        createPortal(
          <aside
            id={id}
            role="tooltip"
            ref={card}
            className={className}
            style={{
              position: "fixed",
              width: RAFT_AVATAR_PREVIEW.width,
              maxWidth: "calc(100vw - 12px)",
              maxHeight: "calc(100vh - 12px)",
              overflow: "auto",
            }}
            onMouseEnter={cancel}
            onMouseLeave={leave}
          >
            {content}
          </aside>,
          document.body,
        )}
    </>
  );
}
