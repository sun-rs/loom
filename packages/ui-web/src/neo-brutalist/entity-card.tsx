import type { ReactNode } from "react";

/** Structural port of Raft hre/X$e. Identity and navigation remain caller-owned. */
export function EntityCard({
  avatar,
  name,
  subtitle,
  trailing,
  onClick,
  disabled = false,
  label,
}: {
  avatar: ReactNode;
  name: string;
  subtitle?: string | undefined;
  trailing?: ReactNode;
  onClick?: (() => void) | undefined;
  disabled?: boolean;
  label?: string | undefined;
}) {
  const content = (
    <>
      {avatar}
      <span className="rah-entity-card-identity">
        <span className="rah-entity-card-name" title={name}>
          {name}
        </span>
        {subtitle ? (
          <span className="rah-entity-card-subtitle" title={subtitle}>
            {subtitle}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className="rah-entity-card-trailing">{trailing}</span>
      ) : null}
    </>
  );
  return onClick ? (
    <button
      className="rah-entity-card"
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {content}
    </button>
  ) : (
    <div className="rah-entity-card">{content}</div>
  );
}
