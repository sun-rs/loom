import { useCallback, useEffect, useState } from "react";
import type { RahClient, RahClientOperationMap } from "@rah-os/client-sdk";

type Query =
  | "task.get"
  | "task.history"
  | "task.global.list"
  | "search"
  | "activity.list"
  | "message.context"
  | "thread.followers";
export function useDiscoveryQuery<K extends Query>(
  client: RahClient,
  operation: K,
  input: RahClientOperationMap[K]["input"],
  enabled = true,
) {
  const queryKey = JSON.stringify([operation, input]);
  const [tick, refresh] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: RahClientOperationMap[K]["output"];
    error?: string;
    loading: boolean;
  }>({ key: "", loading: true });
  useEffect(() => {
    if (
      !enabled ||
      (operation !== "activity.list" &&
        operation !== "task.global.list" &&
        operation !== "task.get" &&
        operation !== "thread.followers")
    )
      return;
    const refreshVisible = () => {
      if (document.visibilityState === "visible") refresh((value) => value + 1);
    };
    const interval = window.setInterval(refreshVisible, 5000);
    window.addEventListener("focus", refreshVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshVisible);
    };
  }, [enabled, operation]);
  useEffect(() => {
    const controller = new AbortController();
    if (!enabled) return () => controller.abort();
    setResult((old) => ({
      ...(old.key === queryKey ? old : {}),
      key: queryKey,
      loading: true,
    }));
    const [, request] = JSON.parse(queryKey) as [
      K,
      RahClientOperationMap[K]["input"],
    ];
    // Small debounce on Search, including fast query/filter/Workspace changes.
    const timer = window.setTimeout(
      () => {
        void client
          .request(operation, request, { signal: controller.signal })
          .then((data) => {
            if (!controller.signal.aborted)
              setResult({ key: queryKey, data, loading: false });
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted)
              setResult((old) => ({
                ...(old.key === queryKey ? old : {}),
                key: queryKey,
                error: error instanceof Error ? error.message : "查询失败",
                loading: false,
              }));
          });
      },
      operation === "search" ? 200 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [client, enabled, operation, queryKey, tick]);
  const current = result.key === queryKey && enabled;
  const refreshResult = useCallback(() => refresh((value) => value + 1), []);
  return {
    data: current ? result.data : undefined,
    error: current ? result.error : undefined,
    loading: current ? result.loading : enabled,
    refresh: refreshResult,
  };
}
