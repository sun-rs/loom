import type { ReactNode } from "react";

/** Source-backed profile body section; identity and permissions belong to callers. */
export function ProfileSection({
  title,
  count,
  children,
  className = "",
  action,
  variant = "section",
  divided = true,
}: {
  title: ReactNode;
  count?: number | undefined;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
  variant?: "section" | "field";
  divided?: boolean;
}) {
  return (
    <section
      className={`rah-profile-section ${className}`.trim()}
      data-variant={variant}
      data-divided={divided}
      aria-label={typeof title === "string" ? title : undefined}
    >
      <h3>
        {title}
        {count === undefined ? null : <span>{count}</span>}
        {action == null ? null : (
          <span className="rah-profile-section-actions">{action}</span>
        )}
      </h3>
      {children}
    </section>
  );
}
