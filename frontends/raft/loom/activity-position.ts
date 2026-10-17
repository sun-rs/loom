import { MAX_ACTIVITY_PAGES } from "./activity-window.ts";
type Position = { depth: number; top: number };
type Store = Pick<Storage, "getItem" | "setItem">;
const key = "loom:activity-position:v1";
const empty = (): Position => ({ depth: 1, top: 0 });
export function activityPositionStorage(): Store | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
function bounded(value: Position): Position {
  return {
    depth: Math.max(1, Math.min(MAX_ACTIVITY_PAGES, Math.floor(value.depth))),
    top: Math.max(0, Math.min(1_000_000, value.top)),
  };
}
export function readActivityPosition(
  store: Pick<Store, "getItem"> | undefined,
  scope: string,
): Position {
  try {
    const value = JSON.parse(store?.getItem(key) ?? "null");
    if (
      value?.scope === scope &&
      Number.isFinite(value.depth) &&
      Number.isFinite(value.top)
    )
      return bounded(value);
  } catch {
    /* Unavailable storage cannot block navigation. */
  }
  return empty();
}
export function writeActivityPosition(
  store: Pick<Store, "setItem"> | undefined,
  scope: string,
  value: Position,
) {
  try {
    store?.setItem(key, JSON.stringify({ scope, ...bounded(value) }));
  } catch {
    /* Keep current in-memory behavior. */
  }
}
