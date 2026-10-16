import { useEffect, useState, type SetStateAction } from "react";
import type { RahClient } from "@rah-os/client-sdk";

type Pages = (string | undefined)[];
// Presentation navigation only. Unlike the upstream Inbox store, this holds no
// items or business projections: returning always rereads the authorized page.
// One scope per authenticated client, matching native filter-change reset.
const windows = new WeakMap<RahClient, { scope: string; pages: Pages }>();
export function useActivityPages(
  client: RahClient,
  scope: string,
  enabled: boolean,
) {
  const [pages, setPages] = useState<Pages>(() => {
    const saved = windows.get(client);
    return enabled && saved?.scope === scope ? saved.pages : [undefined];
  });
  useEffect(() => {
    if (enabled) windows.set(client, { scope, pages });
  }, [client, scope, enabled, pages]);
  return [pages, (update: SetStateAction<Pages>) => setPages(update)] as const;
}
