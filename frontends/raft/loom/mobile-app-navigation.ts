/** Owner-confirmed iOS app navigation, 2026-10-26. Web routes remain authoritative. */
export const mobilePrimaryDestinations = [
  "channels",
  "activity",
  "tasks",
  "search",
] as const;
export function showMobileRootNavigation(
  destination: string,
  params: URLSearchParams,
  mobileList: boolean,
) {
  if (["agents", "computers", "settings", "memory"].includes(destination))
    return false;
  if (destination === "channels" && !mobileList) return false;
  if (params.has("thread") || params.has("side")) return false;
  if (
    (destination === "activity" || destination === "search") &&
    (params.has("room") || params.has("channelId"))
  )
    return false;
  const detail: Record<string, string> = {
    computers: "computer",
    settings: "settings",
    tasks: "task",
    agents: "role",
    memory: "memory",
  };
  return !detail[destination] || !params.has(detail[destination]!);
}

/** Secondary roots are pushed from More; URL snapshot restores filters and list position. */
export function mobileSecondaryRoot(
  destination: string,
  params: URLSearchParams,
) {
  const detail: Record<string, string> = {
    agents: "role",
    computers: "computer",
    settings: "settings",
    memory: "memory",
  };
  return Boolean(detail[destination]) && !params.has(detail[destination]!);
}
