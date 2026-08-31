import { useEffect, useState } from "react";
import type { RahClient, RahClientOperationMap } from "@rah-os/client-sdk";

// Read-model reconciliation only. Never writes a business acknowledgement.
export function useReconciledQuery<
  K extends "host.runtime.list" | "activity.list",
>(
  client: RahClient,
  operation: K,
  input: RahClientOperationMap[K]["input"],
  enabled = true,
) {
  const key = JSON.stringify([operation, input]);
  const [state, setState] = useState<{
    client: RahClient;
    key: string;
    data?: RahClientOperationMap[K]["output"];
    error?: string;
  }>();
  useEffect(() => {
    if (!enabled) return;
    let stopped = false,
      pending = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const load = async () => {
      if (stopped || pending) return;
      clearTimeout(timer);
      pending = true;
      controller = new AbortController();
      const deadline = setTimeout(() => controller?.abort(), 15_000);
      try {
        const data = await client.request(operation, JSON.parse(key)[1], {
          signal: controller.signal,
        });
        if (!stopped && !controller.signal.aborted)
          setState({ client, key, data });
      } catch (error) {
        if (!stopped)
          setState((old) => ({
            ...(old?.client === client && old.key === key ? old : {}),
            client,
            key,
            error: error instanceof Error ? error.message : "读取失败",
          }));
      } finally {
        clearTimeout(deadline);
        pending = false;
        if (!stopped)
          timer = setTimeout(
            load,
            document.visibilityState === "visible" ? 5000 : 15000,
          );
      }
    };
    const focus = () => {
      if (document.visibilityState === "visible") void load();
    };
    void load();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [client, key, enabled, operation]);
  return enabled && state?.client === client && state.key === key
    ? state
    : undefined;
}
