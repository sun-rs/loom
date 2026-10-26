import type { ReactNode } from "react";
export type CollapseColumn = "sidebar" | "activityList";
export function CurrentSidebarToggle(props: {
  column: CollapseColumn;
}): ReactNode;
export function toggleColumn(
  document?: Document,
  column?: CollapseColumn,
): void;
export function setColumnHidden(
  column: CollapseColumn,
  hidden: boolean,
  document?: Document,
): void;
