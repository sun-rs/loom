import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
export type SortableRailBinding = {
  dragProps: ButtonHTMLAttributes<HTMLButtonElement>;
  guardClick: (
    callback: (event: MouseEvent) => void,
  ) => (event: MouseEvent) => void;
};
export function OfficialSortableNavigation(props: {
  tabs: Array<{
    id: string;
    label: string;
    render: (binding: SortableRailBinding) => ReactNode;
  }>;
}): ReactNode;
