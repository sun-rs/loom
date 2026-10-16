/** HTTP trusted-network browsers expose getRandomValues but may omit randomUUID.
 * Keep one browser compatibility boundary for native components and client-core.
 * Never replace the browser's native UUID or fall back to Math.random. */
export function installBrowserUuid(
  crypto: Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">>,
) {
  if (typeof crypto.randomUUID === "function") return;
  Object.defineProperty(crypto, "randomUUID", {
    configurable: true,
    value: () => {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6]! & 15) | 64;
      bytes[8] = (bytes[8]! & 63) | 128;
      const hex = Array.from(bytes, (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
  });
}
installBrowserUuid(globalThis.crypto);
