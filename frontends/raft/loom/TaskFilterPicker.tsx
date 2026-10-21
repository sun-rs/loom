import { useState, type ReactNode } from "react";
import { OfficialTaskFilter } from "./OfficialTaskSurfaces.generated";
export type TaskFilterOption = {
  key: string;
  label: string;
  handle?: string;
  sentinel?: boolean;
  avatar?: ReactNode;
};
export function useTaskFilterController({
  label,
  icon,
  options,
  selected,
  onChange,
  disabled = false,
  open,
  onOpenChange,
  reserveLeadingSlot = false,
}: {
  label: string;
  icon: ReactNode;
  options: TaskFilterOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reserveLeadingSlot?: boolean;
}) {
  const [search, setSearch] = useState("");
  const filtered = options.filter((o) =>
    `${o.label} ${o.handle ?? ""}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return {
    label,
    icon,
    selected,
    isOpen: open,
    disabled,
    search,
    setSearch,
    handleOpenChange: (value: boolean) => {
      if (value) setSearch("");
      onOpenChange(value);
    },
    clearSelection: () => onChange([]),
    popoverOptions: filtered.map((o) => ({
      key: o.key,
      label: o.label,
      checked: selected.includes(o.key),
      italic: o.sentinel,
      avatar: o.avatar,
      reserveLeadingSlot,
      onClick: () =>
        onChange(
          selected.includes(o.key)
            ? selected.filter((v) => v !== o.key)
            : [...selected, o.key],
        ),
    })),
  };
}
export default function TaskFilterPicker(
  props: Parameters<typeof useTaskFilterController>[0],
) {
  return <OfficialTaskFilter {...useTaskFilterController(props)} />;
}
