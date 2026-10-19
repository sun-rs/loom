import type { HTMLAttributes, ReactNode } from "react";
import { Card } from "raft-ui";

export default function SurfaceListItem({
  children,
  selected = false,
  interactive = true,
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  selected?: boolean;
  interactive?: boolean;
}) {
  return (
    <Card
      variant="default"
      className={[
        "min-w-0 w-full px-4 py-3 transition-colors",
        selected ? "bg-info-soft" : "bg-layer-card",
        interactive && !selected ? "hover:press-overlay active:press-overlay" : "",
        className,
      ].join(" ")}
      {...props}
      data-selected={selected ? "true" : undefined}
    >
      {children}
    </Card>
  );
}
