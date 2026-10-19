import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
/** Sidebar preferences remain the sole owner; only load a read projection. */
export function useActivityPinned(
  client: RahClient,
  workspaceId: string,
  enabled: boolean,
  revision: number,
) {
  const [state, setState] = useState<{
    scope: string;
    pinned: string[];
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    void client
      .request("sidebar.get", { workspaceId }, { signal: abort.signal })
      .then((result) => {
        if (!abort.signal.aborted)
          setState({ scope: workspaceId, pinned: result.preferences.pinned });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setState({ scope: workspaceId, pinned: [], failed: true });
      });
    return () => abort.abort();
  }, [client, workspaceId, enabled, revision]);
  return state?.scope === workspaceId ? state : undefined;
}
