// The selected immutable closure is not a whole-App diff. Keep changes outside it visible.
export function partitionNativeChanges(lockedPaths, changes) {
  const locked = new Set(lockedPaths);
  return {
    selected: changes.filter(({ path }) => locked.has(path)),
    outsideLock: changes.filter(({ path }) => !locked.has(path)),
  };
}
