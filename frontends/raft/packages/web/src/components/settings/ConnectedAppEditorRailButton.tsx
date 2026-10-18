import { Button } from "raft-ui";
import { useCallback } from "react";
import type { ConnectedAppEditorRailSection, ConnectedAppEditorSectionId } from "./SettingsPanel";

export function ConnectedAppEditorRailButton({
  section,
  active,
  onSelect,
}: {
  section: ConnectedAppEditorRailSection;
  active: boolean;
  onSelect: (sectionId: ConnectedAppEditorSectionId) => void;
}) {
  const handleClick = useCallback(() => onSelect(section.id), [onSelect, section.id]);
  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      data-app-editor-section={section.id}
      onClick={handleClick}
      aria-current={active ? "true" : undefined}
      className={`h-auto min-w-[155px] flex-col items-start justify-start gap-0 border border-line-muted px-3 py-2 text-left shadow-raft-sm hover:shadow-raft-md md:min-w-0 md:w-full    ${
 active ? "bg-primary-soft  " : "bg-layer-panel "
 }`}
    >
      <span className="flex min-w-0 flex-col items-start">
        <span className="flex items-center gap-2 text-xs font-black text-foreground-strong ">
          {section.icon}
          {section.label}
        </span>
        <span className="mt-1 block truncate text-[10px] font-bold text-foreground-muted ">{section.status}</span>
      </span>
    </Button>
  );
}
