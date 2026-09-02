export type FloatingContextMenuDirection =
  "next" | "previous" | "first" | "last";

function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(value, Math.max(lower, upper)));
}

export function floatingContextMenuPosition(input: {
  anchorX: number;
  anchorY: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  padding?: number;
}): { x: number; y: number } {
  const padding = input.padding ?? 8;
  return {
    x: clamp(
      input.anchorX,
      padding,
      input.viewportWidth - input.menuWidth - padding,
    ),
    y: clamp(
      input.anchorY,
      padding,
      input.viewportHeight - input.menuHeight - padding,
    ),
  };
}

export function nextContextMenuItemIndex(
  enabledIndices: readonly number[],
  currentIndex: number,
  direction: FloatingContextMenuDirection,
): number | undefined {
  if (enabledIndices.length === 0) return undefined;
  if (direction === "first") return enabledIndices[0];
  if (direction === "last") return enabledIndices.at(-1);
  const currentPosition = enabledIndices.indexOf(currentIndex);
  const base = currentPosition < 0 ? 0 : currentPosition;
  const delta = direction === "next" ? 1 : -1;
  return enabledIndices[
    (base + delta + enabledIndices.length) % enabledIndices.length
  ];
}
