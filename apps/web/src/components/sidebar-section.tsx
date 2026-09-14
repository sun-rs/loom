import { useSidebarGroupHandle } from "./sidebar-drag.tsx";
import { useId, useState, type ReactNode } from "react";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

export function SidebarSection({
  label,
  count,
  action,
  children,
  unread = false,
}: {
  label: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
  unread?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const id = useId();
  const handle = useSidebarGroupHandle();
  return (
    <section className="side-section">
      <div className="side-title">
        <button
          ref={handle?.setActivatorNodeRef}
          {...handle?.attributes}
          {...handle?.listeners}
          type="button"
          className="rah-sidebar-disclosure"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="chevron" />
          <span>{label}</span>
          <span className="count">{count}</span>
          {!open && unread && (
            <span className="rah-group-unread" aria-label="有未读消息" />
          )}
        </button>
        {action}
      </div>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </section>
  );
}
