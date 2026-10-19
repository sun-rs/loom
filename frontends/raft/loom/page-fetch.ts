import type { RahFetch } from "@rah-os/client-sdk";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import { observePageRequestLifetime } from "./page-request-lifetime.ts";

// One document lifetime for all Loom JSON clients. Never abort an already sent
// write or retry it here: write-intent remains the sole unknown-result owner.
let controller = new AbortController();
function observe() {
  const dispose = observePageRequestLifetime(
    window,
    controller,
    () => {
      dispose();
      controller = new AbortController();
      observe();
    },
    () => !hasUnresolvedIntents(),
  );
}
if (typeof window !== "undefined") observe();
export const pageFetch: RahFetch = async (url, init) => {
  controller.signal.throwIfAborted();
  return fetch(url, init);
};
