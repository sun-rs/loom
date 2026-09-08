import { useEffect, useState } from "react";
import type { RahClient, RahClientOperationMap } from "@rah-os/client-sdk";

// Read-model reconciliation only. Never writes a business acknowledgement.
export function useReconciledQuery<
  K extends
    | "room.preview"
    | "file.comments"
    | "room.member.list"
    | "host.runtime.list"
    | "activity.list"
    | "agent.presence.list"
    | "notification.list"
    | "workspace.human.list",
>(
  client: RahClient,
  operation: K,
  input: RahClientOperationMap[K]["input"],
  enabled = true,
  refreshKey?: unknown,
) {
  // Refreshing the same scope must retain its read projection and mounted drafts.
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
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const load = async () => {
      if (stopped || pending) return;
      clearTimeout(timer);
      pending = true;
      const request = new AbortController();
      controller = request;
      try {
        const data = await Promise.race([
          client.request(operation, JSON.parse(key)[1], {
            signal: request.signal,
          }),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(() => {
              request.abort();
              reject(new Error("读取超时"));
            }, 15_000);
          }),
        ]);
        if (!stopped && !request.signal.aborted)
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
            document.visibilityState === "visible"
              ? operation === "agent.presence.list"
                ? 1000
                : 5000
              : 15000,
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
      clearTimeout(deadline);
      controller?.abort();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [client, key, enabled, operation, refreshKey]);
  return enabled && state?.client === client && state.key === key
    ? state
    : undefined;
}
