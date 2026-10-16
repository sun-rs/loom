import { useEffect, useMemo, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import {
  buildSearchEntityEntriesWhenQueryPresent,
  filterSearchEntityEntriesForQuery,
  findExactDestination,
} from "../packages/web/src/components/search/searchEntities.ts";
import { useRankedComposerSuggestions } from "../packages/web/src/hooks/useRankedComposerSuggestions.ts";
import { entitySources } from "./search-entities.ts";
export function useSearchEntities(
  client: RahClient,
  workspaceId: string,
  controlRoomId: string | undefined,
  query: string,
  enabled: boolean,
) {
  const [source, setSource] = useState<ReturnType<typeof entitySources>>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled || !controlRoomId) return;
    const controller = new AbortController(),
      options = { signal: controller.signal };
    setSource(undefined);
    setError(false);
    void Promise.all([
      client.request("room.list", { workspaceId }, options),
      client.request("role.list", { controlRoomId }, options),
      client.request("agent.list", { controlRoomId }, options),
    ])
      .then(([rooms, roles, agents]) => {
        if (!controller.signal.aborted)
          setSource(entitySources({ ...rooms, ...roles, ...agents }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [client, workspaceId, controlRoomId, enabled, retry]);
  const entries = useMemo(
    () =>
      source && enabled
        ? filterSearchEntityEntriesForQuery(
            query,
            buildSearchEntityEntriesWhenQueryPresent(
              Boolean(query.trim()),
              source,
            ),
          )
        : [],
    [query, source, enabled],
  );
  const ranked = useRankedComposerSuggestions(query, entries);
  return {
    results: ranked.slice(0, 50),
    exact: findExactDestination(query, ranked),
    error: enabled && error,
    retry: () => setRetry((v) => v + 1),
  };
}
