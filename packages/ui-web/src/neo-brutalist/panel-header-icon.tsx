import { Icon } from "./icon.tsx";

// Raft size-icon-header slot. Identity/presence and navigation remain callers'
// responsibility; this non-interactive icon is not an Agent avatar.
export function PanelHeaderIcon({
  name,
  glyphSize = 18,
  className = "",
}: {
  name: string;
  glyphSize?: 14 | 18;
  className?: string;
}) {
  return (
    <span
      className={`rah-panel-header-icon ${className}`.trim()}
      data-glyph-size={glyphSize}
      aria-hidden="true"
    >
      <Icon name={name} />
    </span>
  );
}
