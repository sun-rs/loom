import { create } from "zustand";
const key = "loom:device:sidebar-hidden";
const computerRackKey = "loom:device:computer-rack-view";
function readComputerRackView(): "list" | "cards" {
  try {
    return localStorage.getItem(computerRackKey) === "cards" ? "cards" : "list";
  } catch {
    return "list";
  }
}
const activityKey = "loom:device:activity-list-hidden";
function read(storageKey = key) {
  try {
    return localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}
export const useSidebarPreference = create<{
  computerRackView: "list" | "cards";
  setComputerRackView: (view: "list" | "cards") => void;
  sidebarHidden: boolean;
  activityListHidden: boolean;
  setActivityListHidden: (hidden: boolean) => void;
  setSidebarHidden: (hidden: boolean) => void;
}>((set) => ({
  computerRackView: readComputerRackView(),
  setComputerRackView: (view) => {
    try {
      localStorage.setItem(computerRackKey, view);
    } catch {
      /* Session only. */
    }
    set({ computerRackView: view });
  },
  sidebarHidden: read(),
  activityListHidden: read(activityKey),
  setActivityListHidden: (activityListHidden) => {
    try {
      localStorage.setItem(activityKey, String(activityListHidden));
    } catch {
      /* session-only */
    }
    set({ activityListHidden });
  },
  setSidebarHidden: (sidebarHidden) => {
    try {
      localStorage.setItem(key, String(sidebarHidden));
    } catch {
      /* Session-only when storage is unavailable. */
    }
    set({ sidebarHidden });
  },
}));
const mac = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform);
export const sidebarShortcutLabel = () => (mac() ? "⌘\\" : "Ctrl+\\");
export const sidebarShortcutKeys = () => (mac() ? "Meta+\\" : "Control+\\");
