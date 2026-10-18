import { Card } from "raft-ui";
import { useCallback } from "react";
import type { BulkResetMode, BulkResetOption } from "./MachineDetailPanel";

export function BulkResetOptionCard({
  option,
  selected,
  disabled,
  onSelect,
}: {
  option: BulkResetOption;
  selected: boolean;
  disabled: boolean;
  onSelect: (mode: BulkResetMode) => void;
}) {
  const { mode } = option;
  const handleClick = useCallback(() => onSelect(mode), [mode, onSelect]);
  return (
    <Card
      render={<button type="button" aria-pressed={selected} disabled={disabled} />}
      onClick={handleClick}
      className={`w-full  p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
 selected
 ? option.selectedClass
 : "border-line-muted  bg-layer-panel  hover:border-line-strong "
 }`}
    >
      <div className="text-sm font-bold uppercase">{option.label}</div>
      <p className="mt-1 text-xs text-foreground-muted ">{option.desc}</p>
    </Card>
  );
}
