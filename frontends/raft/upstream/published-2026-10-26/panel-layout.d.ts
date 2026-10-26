// Loom type facade; implementation is the recorded official resource extraction.
interface Column {
  defaultWidth: number;
  min: number;
  max: number;
  storageKey: string;
  legacyStorageKeys: string[];
  growsToMainMin?: boolean;
}
export const officialPanelLayout: Record<
  "sidebar" | "list" | "thread" | "detail" | "sideCards" | "workspaceTree",
  Column
>;
export function resolveOfficialColumnWidth(
  available: number,
  column: { width: number; min: number },
  rightMin: number,
  mainMin?: number,
): number;
export function resolveOfficialMaxShare(
  available: number,
  share: number,
  min: number,
): number;
