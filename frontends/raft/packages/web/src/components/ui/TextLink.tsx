import type { ButtonHTMLAttributes } from "react";

// Structural port: official v1.21.22 app-shell, TextLink (IX), lines 98737–98755.
// Preserve one shared recipe for history and other retained secondary actions.
export type TextLinkVariant = "primary" | "muted";
const BASE_CLASS =
  "rounded-[2px] underline decoration-[1.5px] underline-offset-[3px] outline-none focus-visible:shadow-raft-focus disabled:cursor-not-allowed disabled:text-foreground-disabled disabled:no-underline";
const VARIANT_CLASS: Record<TextLinkVariant, string> = {
  primary: "font-semibold text-foreground hover:decoration-accent",
  muted: "font-medium text-foreground-muted hover:text-foreground",
};
export default function TextLink({
  variant = "muted",
  inline: _inline,
  type = "button",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: TextLinkVariant;
  inline?: boolean;
}) {
  return (
    <button
      type={type}
      className={`${BASE_CLASS} ${VARIANT_CLASS[variant]} ${className}`.trim()}
      {...props}
    />
  );
}
