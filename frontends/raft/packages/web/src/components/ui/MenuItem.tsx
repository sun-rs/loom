import type { ButtonHTMLAttributes, ReactNode } from "react";

// Structural port: Raft v1.21.22 R4e / t$ action menu composition.
// Native button owns menu row sizing, focus and disabled states.
export type MenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Optional leading icon. Conventionally a lucide icon at `size={14}`. */
  icon?: ReactNode;
  /** Optional right-aligned slot (e.g. shortcut hint). */
  trailing?: ReactNode;
};

export default function MenuItem({
  icon,
  trailing,
  className = "",
  type = "button",
  role = "menuitem",
  children,
  ...rest
}: MenuItemProps) {
  const recipe = [
    "flex min-h-9 w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left [@media(max-height:600px)]:min-h-8 [@media(max-height:600px)]:py-1",
    "font-sans text-callout font-medium text-foreground",
    "outline-none transition-colors enabled:hover:bg-primary-soft enabled:focus-visible:bg-primary-soft",
    "[&>svg]:shrink-0 [&>svg:first-child]:text-foreground-icon",
    "disabled:cursor-not-allowed disabled:text-foreground-disabled disabled:[&>svg:first-child]:text-foreground-disabled",
  ].join(" ");

  return (
    <button
      type={type}
      role={role}
      data-slot="menu-item"
      className={`${recipe} ${className}`.trim()}
      {...rest}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </button>
  );
}
