import type { WorkspaceSearchRequest } from "@rah-os/protocol";
import {
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
  "sort" | "senderKind" | "mentionSelf" | "after" | "before"
> {
  const scopes = normalizeSearchScopes((params.get("scopes") ?? "").split(","));
  const human = scopes.includes("humans"),
    agent = scopes.includes("agents");
  return {
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
