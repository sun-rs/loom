import { Menu } from "@base-ui/react/menu";
import type { ReactElement, ReactNode } from "react";

/** Shared anchored action menu; Base UI owns focus, dismissal and positioning. */
export function ActionMenu({
  open,
  onOpenChange,
  label,
  trigger,
  className,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  trigger: ReactElement;
  className: string;
  items: readonly {
    label: ReactNode;
    key: string;
    disabled?: boolean;
    onSelect: () => void;
  }[];
}) {
  return (
    <Menu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Menu.Trigger render={trigger} />
      <Menu.Portal>
        <Menu.Positioner
          side="bottom"
          align="end"
          sideOffset={4}
          collisionPadding={8}
          style={{ zIndex: 100 }}
        >
          <Menu.Popup aria-label={label} className={className}>
            {items.map((item) => (
              <Menu.Item
                key={item.key}
                render={<button type="button" />}
                nativeButton
                disabled={item.disabled ?? false}
                onClick={item.onSelect}
              >
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
