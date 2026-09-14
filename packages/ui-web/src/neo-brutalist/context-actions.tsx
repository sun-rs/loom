import { ContextMenu } from "@base-ui/react/context-menu";
import { useRef, type ReactElement, type ReactNode } from "react";

export type ContextAction = {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  separator?: boolean;
  onSelect?: () => void;
  children?: readonly ContextAction[];
};
function Items({ items }: { items: readonly ContextAction[] }) {
  return (
    <>
      {items.map((item) => (
        <div key={item.key}>
          {item.separator && (
            <ContextMenu.Separator className="rah-context-separator" />
          )}
          {item.children ? (
            <ContextMenu.SubmenuRoot>
              <ContextMenu.SubmenuTrigger disabled={item.disabled ?? false}>
                {item.label}
                <span aria-hidden style={{ marginLeft: "auto" }}>
                  ›
                </span>
              </ContextMenu.SubmenuTrigger>
              <ContextMenu.Portal>
                <ContextMenu.Positioner
                  side="right"
                  align="start"
                  collisionPadding={8}
                  style={{ zIndex: 101 }}
                >
                  <ContextMenu.Popup className="rah-context-actions">
                    <Items items={item.children} />
                  </ContextMenu.Popup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
            </ContextMenu.SubmenuRoot>
          ) : (
            <ContextMenu.Item
              disabled={item.disabled ?? false}
              onClick={item.onSelect}
            >
              {item.label}
            </ContextMenu.Item>
          )}
        </div>
      ))}
    </>
  );
}
/** Pointer, long press and keyboard menus share Base UI focus/dismissal ownership. */
export function ContextActions({
  trigger,
  label,
  items,
}: {
  trigger: ReactElement;
  label: string;
  items: readonly ContextAction[];
}) {
  const suppressTouchClick = useRef(false);
  return (
    <ContextMenu.Root
      onOpenChange={(open, details) => {
        if (open && details.event.type === "touchstart")
          suppressTouchClick.current = true;
      }}
    >
      <ContextMenu.Trigger
        render={trigger}
        onPointerDown={() => {
          suppressTouchClick.current = false;
        }}
        onTouchStart={() => {
          suppressTouchClick.current = false;
        }}
        onClickCapture={(event) => {
          // A long press belongs to the menu, not the trigger's normal action.
          // Clear on the next gesture even if this browser emits no release click.
          if (suppressTouchClick.current && event.detail !== 0) {
            suppressTouchClick.current = false;
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onContextMenu={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (
            event.key !== "ContextMenu" &&
            !(event.shiftKey && event.key === "F10")
          )
            return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: rect.left,
              clientY: rect.bottom,
            }),
          );
        }}
      />
      <ContextMenu.Portal>
        <ContextMenu.Positioner collisionPadding={8} style={{ zIndex: 100 }}>
          <ContextMenu.Popup aria-label={label} className="rah-context-actions">
            <Items items={items} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
