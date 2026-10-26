import type { ComponentProps, ComponentType } from "react";
import {
  CurrentColumnResize,
  useCurrentColumnWidth,
} from "../upstream/published-2026-10-26/column-resize.js";
export type ListColumn = "list" | "memoryList";
// The published functions look up columns through Loom's registry. Memory is a
// local registry alias, not a change to the immutable upstream implementation.
type Props = Omit<ComponentProps<typeof CurrentColumnResize>, "column"> & {
  column: ListColumn;
};
const NativeResize = CurrentColumnResize as ComponentType<Props>;
export function ListColumnResize({ label = "调整列表宽度", ...props }: Props) {
  return <NativeResize {...props} label={label} />;
}
export const useListColumnWidth = useCurrentColumnWidth as (
  column: ListColumn,
) => number;
