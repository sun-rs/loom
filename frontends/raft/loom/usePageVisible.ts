import { useSyncExternalStore } from "react";
// Browser visibility only gates diagnostic reads; it never pauses execution or delivery.
const subscribe = (changed: () => void) => {
  document.addEventListener("visibilitychange", changed);
  return () => document.removeEventListener("visibilitychange", changed);
};
const snapshot = () => document.visibilityState !== "hidden";
export function usePageVisible() {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
