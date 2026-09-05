import type { ComponentPropsWithRef } from "react";

// Visual/action primitive only. Existing sq-btn / interaction-state owns all
// colors, shadows and motion. Native disabled also covers pending actions.
export function PanelHeaderAction({
  className = "",
  pending = false,
  size = "header",
  disabled,
  type = "button",
  ...props
}: ComponentPropsWithRef<"button"> & {
  "aria-label": string;
  pending?: boolean;
  size?: "header" | "compact";
}) {
  return (
    <button
      {...props}
      type={type}
      className={`sq-btn rah-panel-header-action ${className}`.trim()}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-action-size={size}
    />
  );
}
