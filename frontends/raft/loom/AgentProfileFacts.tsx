import type { ReactNode } from "react";
// Structural port of official AgentDetailPanel InfoRow (v1.21.22, lines 594+).
// Keep the native label/value columns, typography and wrapping; data is Loom-owned.
export function ProfileFact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.75rem_minmax(0,1fr)] items-start gap-x-4">
      <dt className="flex min-h-5 items-center gap-1.5 text-[13px] text-foreground-hint">
        <span className="truncate">{label}</span>
      </dt>
      <dd className="m-0 min-w-0 break-words text-sm text-foreground-muted">
        {children}
      </dd>
    </div>
  );
}
