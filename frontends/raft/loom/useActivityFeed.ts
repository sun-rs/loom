import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { HumanActivityRequest } from "@rah-os/protocol";
import { activityPage, type DiscoveryPageResult } from "./discovery-client.ts";
import {
  appendActivityPage,
  readActivityWindow,
  MAX_ACTIVITY_PAGES,
  MAX_ACTIVITY_ROWS,
} from "./activity-window.ts";
// One presentation window per authenticated client. Save depth only: every
// return rereads authorized data with fresh cursors, never cached transcripts.
const windows = new WeakMap<RahClient, { scope: string; depth: number }>();
export function useActivityFeed(
  client: RahClient,
  workspaceId: string,
  filter: HumanActivityRequest["filter"],
  enabled: boolean,
  revision: number,
) {
  const scope = JSON.stringify([workspaceId, filter]);
  const [data, setData] = useState<DiscoveryPageResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const depth = useRef(1);
  const seen = useRef(new Set<string>());
  const read = (cursor: string | undefined, signal: AbortSignal) =>
    activityPage(
      client,
      { workspaceId, filter, limit: 20, ...(cursor ? { cursor } : {}) },
      signal,
    );
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const saved = windows.get(client);
    const wanted = saved?.scope === scope ? saved.depth : 1;
    windows.set(client, { scope, depth: wanted });
    setLoading(true);
    setData(undefined);
    setError("");
    setMoreError(false);
    setLoadingMore(false);
    seen.current = new Set();
    void readActivityWindow((cursor) => read(cursor, controller.signal), wanted)
      .then((result) => {
        if (controller.signal.aborted) return;
        depth.current = result.pages;
        windows.set(client, { scope, depth: result.pages });
        setData(result.data);
        setMoreError(result.incomplete);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("读取失败，请重试。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      pending.current?.abort();
      pending.current = null;
    };
  }, [client, scope, enabled, revision]);
  const atLimit =
    depth.current >= MAX_ACTIVITY_PAGES ||
    (data?.rows.length ?? 0) >= MAX_ACTIVITY_ROWS;
  const loadMore = async () => {
    if (
      !enabled ||
      loading ||
      moreError ||
      pending.current ||
      !data?.nextCursor ||
      atLimit
    )
      return;
    const cursor = data.nextCursor;
    if (seen.current.has(cursor)) return;
    const controller = new AbortController();
    pending.current = controller;
    setLoadingMore(true);
    try {
      const next = await read(cursor, controller.signal);
      if (controller.signal.aborted) return;
      seen.current.add(cursor);
      depth.current++;
      windows.set(client, { scope, depth: depth.current });
      setData(
        appendActivityPage(data, {
          ...next,
          nextCursor:
            next.nextCursor === cursor ||
            (next.nextCursor && seen.current.has(next.nextCursor))
              ? undefined
              : next.nextCursor,
        }),
      );
    } catch {
      if (!controller.signal.aborted) setMoreError(true);
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setLoadingMore(false);
      }
    }
  };
  return { data, loading, error, loadingMore, moreError, atLimit, loadMore };
}
