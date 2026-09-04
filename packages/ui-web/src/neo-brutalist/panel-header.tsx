import type { HTMLAttributes } from "react";

// Presentation only. The shell owns --head-h; pages own identity and actions.
export function PanelHeader({
  kind,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & {
  kind: "conversation" | "agent" | "thread";
}) {
  return (
    <header
      {...props}
      className={`rah-panel-header ${className}`.trim()}
      data-header-kind={kind}
    />
  );
}
