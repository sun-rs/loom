import { useSyncExternalStore } from "react";

const query = "(max-width: 767px)";
const subscribe = (changed: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
};
/** One viewport contract for responsive navigation and visible-detail indicators. */
export function useMobileLayout() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
