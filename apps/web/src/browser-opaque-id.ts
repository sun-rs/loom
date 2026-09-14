import { opaqueIdFromBytes } from "@rah-os/ui-web";

/** getRandomValues remains available on the user's trusted HTTP Tailnet origin. */
export function browserOpaqueId(
  source: Pick<Crypto, "getRandomValues"> = globalThis.crypto,
): string {
  return opaqueIdFromBytes(source.getRandomValues(new Uint8Array(16)));
}
