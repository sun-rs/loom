type PreferenceStore = Pick<Storage, "getItem" | "setItem">;
const key = "loom:file-device";
/** Presentation preference only. Browser origin is not proof of physical identity. */
export function usesDaemonDevice(url: URL, store?: PreferenceStore): boolean {
  let preference = url.searchParams.get("fileDevice");
  if (preference === "local" || preference === "remote") {
    try {
      store?.setItem(key, preference);
    } catch {
      /* Storage is optional. */
    }
  } else {
    try {
      preference = store?.getItem(key) ?? null;
    } catch {
      preference = null;
    }
  }
  if (preference === "local") return true;
  if (preference === "remote") return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
export function browserUsesDaemonDevice(): boolean {
  let store: PreferenceStore | undefined;
  try {
    store = window.sessionStorage;
  } catch {
    /* Fall back to the URL preference. */
  }
  return usesDaemonDevice(new URL(window.location.href), store);
}
