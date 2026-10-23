/** Explicit user recovery only. Existing write slots remain the authority. */
export function requestPageReload(blocked: () => boolean, reload: () => void) {
  if (blocked()) return false;
  reload();
  return true;
}
