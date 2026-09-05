import type { ReactNode } from "react";
import { Icon } from "./icon.tsx";

/** Raft empty-state families are named contexts, not page-local geometry. */
export function EmptyState({
  context,
  placement,
  icon,
  title,
  description,
  action,
}: {
  context: "search" | "profile" | "task" | "activity";
  placement: "fill" | "section";
  icon: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="rah-empty-state"
      data-context={context}
      data-placement={placement}
    >
      <div className="rah-empty-state-content">
        <span className="rah-empty-state-icon" aria-hidden="true">
          <Icon name={icon} />
        </span>
        <p className="rah-empty-state-title">{title}</p>
        {description ? (
          <p className="rah-empty-state-description">{description}</p>
        ) : null}
        {action ? <div className="rah-empty-state-action">{action}</div> : null}
      </div>
    </div>
  );
}
