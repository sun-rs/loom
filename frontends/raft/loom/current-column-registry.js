import { officialPanelLayout } from "../upstream/published-2026-10-26/panel-layout.js";
// UI-only local width ownership. Never read/migrate the upstream application's storage.
const prior = {
  thread: ["loom:threadPanelWidth"],
  detail: ["loom:profilePanelWidth"],
  list: [],
  sidebar: [],
  sideCards: [],
  workspaceTree: [],
};
export const currentColumnRegistry = Object.fromEntries(
  Object.entries(officialPanelLayout).map(([id, definition]) => [
    id,
    {
      ...definition,
      storageKey: `loom:columnWidth:${id}`,
      legacyStorageKeys: prior[id],
    },
  ]),
);

// Loom Side retains its independent pre-upgrade width preference.
currentColumnRegistry.side = {
  ...currentColumnRegistry.thread,
  storageKey: "loom:columnWidth:side",
  legacyStorageKeys: ["loom:sidePanelWidth"],
};
