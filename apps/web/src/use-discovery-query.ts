import { useCallback, useEffect, useRef, useState } from "react";
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
  const refresh = useRef<() => void>(() => {});
  const [result, setResult] = useState<{
    client?: RahClient;
    key: string;
    data?: RahClientOperationMap[K]["output"];
    error?: string;
    loading: boolean;
  }>({ key: "", loading: true });
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let active: AbortController | undefined;
    const polling = [
      "activity.list",
      "task.global.list",
      "task.get",
      "thread.followers",
    ].includes(operation);
    const load = async () => {
      if (stopped || pending) return;
      clearTimeout(timer);
      pending = true;
      const controller = new AbortController();
      active = controller;
      setResult((old) => ({
        ...(old.client === client && old.key === queryKey ? old : {}),
        client,
        key: queryKey,
        loading: true,
      }));
      try {
        const data = await Promise.race([
          client.request(operation, JSON.parse(queryKey)[1], {
            signal: controller.signal,
          }),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(() => {
              controller.abort();
              reject(new Error("读取超时，请重试"));
            }, 15000);
          }),
        ]);
        if (!stopped)
          setResult({ client, key: queryKey, data, loading: false });
      } catch (error) {
        if (!stopped)
          setResult((old) => ({
            ...(old.client === client && old.key === queryKey ? old : {}),
            client,
            key: queryKey,
            error: error instanceof Error ? error.message : "查询失败",
            loading: false,
          }));
      } finally {
        clearTimeout(deadline);
        pending = false;
        if (!stopped && polling)
          timer = setTimeout(
            load,
            document.visibilityState === "visible" ? 5000 : 15000,
          );
      }
    };
    const focus = () => {
      if (document.visibilityState === "visible") void load();
    };
    refresh.current = () => {
      void load();
    };
    timer = setTimeout(load, operation === "search" ? 200 : 0);
    if (polling) window.addEventListener("focus", focus);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      active?.abort();
      refresh.current = () => {};
      window.removeEventListener("focus", focus);
    };
  }, [client, enabled, operation, queryKey]);
  const current =
    result.client === client && result.key === queryKey && enabled;
  const refreshResult = useCallback(() => refresh.current(), []);
  return {
    data: current ? result.data : undefined,
    error: current ? result.error : undefined,
    loading: current ? result.loading : enabled,
    refresh: refreshResult,
  };
}
