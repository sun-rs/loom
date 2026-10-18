// Device-only migration from the retired two-family preferences. No family remains active.
export type AppearanceMode = "light" | "dark" | "system";
export const modeKey = "loom-raft-mode-v3";
export function readMode(storage: Pick<Storage, "getItem">): AppearanceMode {
  try {
    const mode = storage.getItem(modeKey);
    if (mode === "light" || mode === "dark" || mode === "system") return mode;
    const old = JSON.parse(
      storage.getItem("slock-theme-preferences-v2") || "null",
    );
    if (["light", "dark", "system"].includes(old?.mode)) return old.mode;
    const preset = storage.getItem("slock-theme-preset");
    if (preset === "brutal" || preset === "elegant-light") return "light";
    if (preset === "elegant-dark") return "dark";
  } catch {
    /* Storage may be unavailable. */
  }
  return "system";
}
