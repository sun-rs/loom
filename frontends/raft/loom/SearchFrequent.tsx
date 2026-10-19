import { SearchResultsList, SearchResultsSectionHeading } from "raft-ui";
import { useMemo } from "react";
import { useIntl } from "react-intl";
import { Star } from "lucide-react";

import { SearchHomeEntityRow } from "../packages/web/src/components/search/SearchHomeEntityRow.tsx";
import {
  selectFrequentSearchEntities,
  type SearchEntityUsage,
} from "../packages/web/src/components/search/searchHome.ts";
import {
  getSearchEntityUsageScopeKey,
  useSearchEntityUsageStore,
} from "../packages/web/src/store/searchEntityUsageStore.ts";
import type { SearchEntity } from "./search-entities.ts";
import type { useSearchEntities } from "./useSearchEntities.ts";
const EMPTY_USAGE: SearchEntityUsage = {};
export function rememberSearchDestination(
  workspaceId: string,
  principalId: string | undefined,
  entityKey: string,
) {
  const scope = getSearchEntityUsageScopeKey(workspaceId, principalId);
  if (scope) useSearchEntityUsageStore.getState().recordOpen(scope, entityKey);
}
export function useSearchFrequent(
  entities: ReturnType<typeof useSearchEntities>,
  workspaceId: string,
  principalId?: string,
) {
  const scope = getSearchEntityUsageScopeKey(workspaceId, principalId);
  const usage = useSearchEntityUsageStore((s) =>
    scope ? (s.scopes[scope]?.usage ?? EMPTY_USAGE) : EMPTY_USAGE,
  );
  return useMemo(
    () =>
      selectFrequentSearchEntities({
        entities: entities.catalog.map((e) => e.suggestion),
        usage,
        eligibleEntityKeys: new Set(
          entities.catalog
            .map((e) => e.suggestion)
            .filter(
              (e) =>
                e.type === "channel" ||
                !entities.hiddenDms.includes("peer:" + e.agentId),
            )
            .map((e) => e.key),
        ),
        currentUserId: principalId,
      }),
    [entities.catalog, entities.hiddenDms, usage, principalId],
  );
}
/** Native home section composition; native tile and ranking/store are reused directly. */
export default function SearchFrequent({
  entities,
  onOpen,
}: {
  entities: SearchEntity[];
  onOpen: (entity: SearchEntity, full: boolean) => void;
}) {
  const { formatMessage } = useIntl();
  return (
    <section aria-labelledby="search-frequent-heading">
      <SearchResultsSectionHeading>
        <Star size={14} aria-hidden="true" />
        <span id="search-frequent-heading">
          {formatMessage({ id: "search.frequent" })}
        </span>
      </SearchResultsSectionHeading>
      {entities.length ? (
        <SearchResultsList>
          {entities.map((entity) => (
            <SearchHomeEntityRow
              key={entity.key}
              result={
                entity.type === "agentDm"
                  ? { ...entity, agentId: null }
                  : entity
              }
              agentAvatarUrl={null}
              humanMember={undefined}
              onActivate={() => onOpen(entity, false)}
            />
          ))}
        </SearchResultsList>
      ) : (
        <p className="px-4 py-2 text-callout text-foreground-hint">
          {formatMessage({ id: "search.frequentEmpty" })}
        </p>
      )}
    </section>
  );
}
