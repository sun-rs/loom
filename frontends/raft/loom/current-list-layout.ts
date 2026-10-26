// Typed adapter over the published official width calculation; no business state.
import {
  officialPanelLayout,
  resolveOfficialColumnWidth,
  resolveOfficialMaxShare,
} from "../upstream/published-2026-10-26/panel-layout.js";
const { min, max, defaultWidth } = officialPanelLayout.list;
export const LIST_BOUNDS = { min, max, defaultWidth };
export function resolveListWidth(
  preferred: number,
  available: number,
  half: boolean,
  rightMin = 0,
): number {
  const width = resolveOfficialColumnWidth(
    available,
    { width: preferred, min },
    rightMin,
  );
  return half
    ? Math.min(width, resolveOfficialMaxShare(available, 0.5, min))
    : width;
}
