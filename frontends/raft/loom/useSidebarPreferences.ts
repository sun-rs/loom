import { useEffect, useState, useCallback } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { SidebarPreferences } from "@rah-os/protocol";
/** Read projection only. Kernel sidebar preferences remain authoritative. */
export function useSidebarPreferences(client: RahClient, workspaceId?: string) {
  const [value, setValue] = useState<{
    workspaceId: string;
    preferences: SidebarPreferences;
  }>();
  const [error, setError] = useState(false),
    [loading, setLoading] = useState(true),
    [epoch, setEpoch] = useState(0);
  const reload = useCallback(() => setEpoch((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener("loom:sidebar-preferences-changed", reload);
    window.addEventListener("focus", reload);
    const timer = setInterval(reload, 30000);
    return () => {
      window.removeEventListener("loom:sidebar-preferences-changed", reload);
      window.removeEventListener("focus", reload);
      clearInterval(timer);
    };
  }, [reload]);
  useEffect(() => {
    if (!workspaceId) return;
    const abort = new AbortController();
    setLoading(true);
    void client
      .request("sidebar.get", { workspaceId }, { signal: abort.signal })
      .then(({ preferences }) => {
        if (abort.signal.aborted) return;
        setValue((previous) =>
          previous?.workspaceId === workspaceId &&
          previous.preferences.version > preferences.version
            ? previous
            : { workspaceId, preferences },
        );
        setError(false);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [client, workspaceId, epoch]);
  return {
    preferences:
      value && value.workspaceId === workspaceId
        ? value.preferences
        : undefined,
    error,
    loading,
    reload,
  };
}
