import type { WorkspaceSearchRequest } from "@rah-os/protocol";
import {
  groupMessageSearchResults,
  buildTimeRangeParams,
  getEffectiveMessageSearchSort,
  normalizeSearchScopes,
  normalizeSearchSort,
  normalizeSearchTimeRange,
} from "../packages/web/src/components/search/searchGrouping.ts";
/** Wire native search semantics to the existing Kernel filters; no second search implementation. */
export function nativeSearchFilters(
  params: URLSearchParams,
  query: string,
  now = new Date(),
): Pick<
  WorkspaceSearchRequest,
  | "sort"
  | "senderKind"
  | "mentionSelf"
  | "after"
  | "before"
  | "senderIds"
  | "roomIds"
> {
  const scopes = normalizeSearchScopes((params.get("scopes") ?? "").split(","));
  const human = scopes.includes("humans"),
    agent = scopes.includes("agents");
  return {
    ...(params.get("senderId") ? { senderIds: [params.get("senderId")!] } : {}),
    ...(params.get("channelId") ? { roomIds: [params.get("channelId")!] } : {}),
    sort: getEffectiveMessageSearchSort(
      query,
      normalizeSearchSort(params.get("sort")),
    ),
    ...(scopes.includes("mentioned") ? { mentionSelf: true } : {}),
    ...(human === agent
      ? {}
      : { senderKind: human ? ("human" as const) : ("agent" as const) }),
    ...buildTimeRangeParams(normalizeSearchTimeRange(params.get("range")), now),
  };
}

/** MessageSearchPage setSenderFilter/setScopeFilters/clearAllFilters, adapted to comma-separated route scopes. */
export function changeNativeSearchFilter(
  params: URLSearchParams,
  key: string,
  value: string,
  kinds: ReadonlyMap<string, string>,
) {
  const next = new URLSearchParams(params);
  if (key === "clear") {
    for (const name of ["senderId", "channelId", "range", "scopes"])
      next.delete(name);
    return next;
  }
  if (value) next.set(key, value);
  else next.delete(key);
  const scopes = normalizeSearchScopes((next.get("scopes") ?? "").split(","));
  const human = scopes.includes("humans"),
    agent = scopes.includes("agents");
  const exclusive = human === agent ? null : human ? "human" : "agent";
  const senderKind = kinds.get(next.get("senderId") ?? "");
  if (exclusive && senderKind && exclusive !== senderKind) {
    if (key === "senderId") {
      const remaining = scopes.filter((scope) => scope === "mentioned");
      if (remaining.length) next.set("scopes", remaining.join(","));
      else next.delete("scopes");
    } else if (key === "scopes") next.delete("senderId");
  }
  return next;
}

/** Preserve native grouping; only adapt canonical message fields. Bounded to the loaded page. */
export function groupSearchRows(
  rows: import("./discovery-client.ts").DiscoveryRow[],
) {
  return groupMessageSearchResults(
    rows.map((row) => ({
      row,
      id: row.id,
      threadId: row.message.threadId ?? null,
      parentMessageId: row.rootMessageId ?? null,
      parentMessageContent: row.rootMessagePreview ?? null,
      createdAt: row.message.createdAt,
    })),
  );
}
