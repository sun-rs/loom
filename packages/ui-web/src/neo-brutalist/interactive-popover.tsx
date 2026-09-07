import { Popover } from "@base-ui/react/popover";
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

const Context = createContext<{
  group: string;
  blocked: { current: boolean };
  side: "right" | "bottom";
} | null>(null);

/** Shared interactive overlay. Base UI owns hover bridges, dismissal and focus. */
export function InteractivePopover({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const blocked = useRef(false);
  const group = useId();
  const [triggerId, setTriggerId] = useState<string | null>(null);
  const [side, setSide] = useState<"right" | "bottom">("right");
  useLayoutEffect(() => {
    if (
      !open ||
      (triggerId && document.getElementById(triggerId)?.getClientRects().length)
    )
      return;
    // Typed notification links can open before a pointer/keyboard trigger exists.
    const trigger = [
      ...document.querySelectorAll<HTMLElement>("[data-popover-group]"),
    ].find(
      (element) =>
        element.dataset.popoverGroup === group &&
        element.getClientRects().length > 0,
    );
    if (trigger) {
      setTriggerId(trigger.id);
      setSide(trigger.dataset.popoverSide === "bottom" ? "bottom" : "right");
    }
  }, [open, triggerId, group]);
  return (
    <Popover.Root
      open={open}
      triggerId={triggerId}
      onOpenChange={(next, details) => {
        if (!next && blocked.current) {
          details.cancel();
          return;
        }
        if (details.trigger) {
          setTriggerId(details.trigger.id);
          setSide(
            details.trigger.getAttribute("data-popover-side") === "bottom"
              ? "bottom"
              : "right",
          );
        }
        onOpenChange(next);
      }}
    >
      <Context.Provider value={{ blocked, side, group }}>
        {children}
      </Context.Provider>
    </Popover.Root>
  );
}

export function InteractivePopoverTrigger({
  render,
  hover = false,
}: {
  render: ReactElement;
  hover?: boolean;
}) {
  const context = useContext(Context);
  // Connection screens can render the disabled navigation without an overlay.
  return context ? (
    <Popover.Trigger
      render={render}
      openOnHover={hover}
      delay={0}
      closeDelay={120}
      data-popover-side={hover ? "right" : "bottom"}
      data-popover-group={context.group}
    />
  ) : (
    render
  );
}

export function InteractivePopoverContent({
  blocked,
  children,
  label,
  className,
}: {
  blocked: boolean;
  children: ReactNode;
  label: string;
  className: string;
}) {
  const context = useContext(Context);
  useLayoutEffect(() => {
    if (!context) return;
    context.blocked.current = blocked;
    return () => {
      context.blocked.current = false;
    };
  }, [blocked, context?.blocked]);
  return (
    <Popover.Portal>
      <Popover.Positioner
        side={context?.side ?? "right"}
        align="end"
        sideOffset={8}
        className="rah-interactive-popover-positioner"
      >
        <Popover.Popup
          aria-label={label}
          className={className}
          initialFocus={(type) => type === "keyboard"}
        >
          {children}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  );
}
