import { useSidebarGroupHandle } from "./sidebar-drag.tsx";
import { useId, useState, type ReactNode } from "react";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useSidebarPreferences } from "./sidebar-preferences.tsx";

export function SidebarSection({
  label,
  sectionId,
  count,
  action,
  children,
  unread = false,
}: {
  label: string;
  sectionId: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
  unread?: boolean;
}) {
  const preferences = useSidebarPreferences();
  const [localChoice, setLocalChoice] = useState<boolean>();
  const open = preferences?.disclosure[sectionId] ?? localChoice ?? count > 0;
  const id = useId();
  const handle = useSidebarGroupHandle();
  return (
    <section className="side-section" data-empty={count === 0}>
      <div className="side-title">
        <button
          ref={handle?.setActivatorNodeRef}
          {...handle?.attributes}
          {...handle?.listeners}
          type="button"
          className="rah-sidebar-disclosure"
          aria-expanded={open}
          aria-controls={id}
          onClick={() =>
            preferences
              ? preferences.setDisclosure(sectionId, !open)
              : setLocalChoice(!open)
          }
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
