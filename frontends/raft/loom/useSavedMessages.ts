import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import { WriteIntentSlot } from "@rah-os/client-core/write-intent";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
export type SavedResult = Awaited<ReturnType<ReturnType<typeof savedReader>>>;
function savedReader(client: RahClient) {
  return (workspaceId: string, cursor?: string) =>
    client.request("message.saved", {
      workspaceId,
      limit: 20,
      sortDirection: "desc",
      ...(cursor ? { cursor } : {}),
    });
}
export function useSavedMessages(client: RahClient, workspaceId: string) {
  const [result, setResult] = useState<SavedResult>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const serial = useRef(0),
    busy = useRef(false),
    current = useRef(result);
  current.current = result;
  const writes = useMemo(() => new WriteIntentSlot(), [client, workspaceId]);
  const [state, setState] = useState(writes.state);
  useRouteIntentOwner(writes);
  useEffect(() => {
    const stop = writes.onChange(setState);
    return () => {
      stop();
      writes.discard();
    };
  }, [writes]);
  const read = useCallback(
    async (more = false) => {
      if (more && (busy.current || !current.current?.nextCursor)) return;
      const ticket = ++serial.current;
      busy.current = true;
      setLoading(true);
      setError("");
      try {
        const next = await savedReader(client)(
          workspaceId,
          more ? current.current?.nextCursor : undefined,
        );
        if (ticket !== serial.current) return;
        setResult((old) => ({
          ...next,
          items: more
            ? [
                ...(old?.items ?? []),
                ...next.items.filter(
                  (row) =>
                    !old?.items.some(
                      (item) =>
                        item.message.messageId === row.message.messageId,
                    ),
                ),
              ]
            : next.items,
        }));
      } catch {
        if (ticket === serial.current) setError("无法读取收藏，请重试。");
      } finally {
        if (ticket === serial.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [client, workspaceId],
  );
  useEffect(() => {
    void read();
    const refresh = () => void read();
    window.addEventListener("loom:saved-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      serial.current++;
      window.removeEventListener("loom:saved-changed", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [read]);
  const remove = useCallback(
    (messageId: string) => {
      const row = current.current?.items.find(
        (r) => r.message.messageId === messageId,
      );
      if (!row || writes.state !== "idle") return;
      void writes.submitRevisioned({
        action: "message-save",
        payload: { roomId: row.message.roomId, messageId, saved: false },
        send: (payload, idempotencyKey) =>
          client.request("message.save", { ...payload, idempotencyKey }),
        onSettled: (outcome) => {
          if (outcome.kind === "ok")
            window.dispatchEvent(new Event("loom:saved-changed"));
          else
            setError(
              outcome.kind === "unknown"
                ? "取消收藏结果未知，请核实原请求。"
                : "取消收藏失败。",
            );
        },
      });
    },
    [client, writes],
  );
  return { result, loading, error, read, remove, writes, state };
}
