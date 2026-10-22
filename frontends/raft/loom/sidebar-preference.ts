import { create } from "zustand";
const key = "loom:device:sidebar-hidden";
function read() {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}
export const useSidebarPreference = create<{
  sidebarHidden: boolean;
  setSidebarHidden: (hidden: boolean) => void;
}>((set) => ({
  sidebarHidden: read(),
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
