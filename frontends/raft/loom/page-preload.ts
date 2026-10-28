import {
  LazyAgentPage,
  LazyComputersPage,
  LazyDiscoveryPage,
  LazyMemoryPage,
  LazySettingsPage,
  LazyTasksPage,
} from "./LazyPages.tsx";
import { layoutQueries } from "./adaptive-layout.ts";

// Code modules only. No page is mounted, data prefetched or business state cached.
const pages = {
  activity: LazyDiscoveryPage,
  search: LazyDiscoveryPage,
  tasks: LazyTasksPage,
  agents: LazyAgentPage,
  computers: LazyComputersPage,
  settings: LazySettingsPage,
  memory: LazyMemoryPage,
};
function allowed() {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;
  return (
    !document.hidden &&
    window.matchMedia(layoutQueries.compactDensity).matches &&
    !connection?.saveData &&
    !["slow-2g", "2g"].includes(connection?.effectiveType ?? "")
  );
}
export function preloadDestination(destination: string) {
  if (!allowed()) return;
  const page = pages[destination as keyof typeof pages];
  // Speculation never raises an application error. Actual navigation retains
  // the existing import failure/recovery owner and the exact same pending import.
  if (page) void page.preload().catch(() => {});
}
export function preloadMorePages() {
  let active = true;
  void (async () => {
    for (const page of [
      LazyAgentPage,
      LazyComputersPage,
      LazySettingsPage,
      LazyMemoryPage,
    ]) {
      if (!active || !allowed()) return;
      try {
        await page.preload();
      } catch {
        return;
      }
    }
  })();
  return () => {
    active = false;
  };
}
export function scheduleMobilePageWarmup() {
  if (!allowed()) return () => {};
  const run = () => {
    preloadDestination("activity");
    preloadDestination("tasks");
  };
  if (window.requestIdleCallback) {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 1500);
  return () => window.clearTimeout(id);
}
