import { useEffect, useRef } from "react";
import { useIntl } from "react-intl";
import {
  SearchResultsSection,
  SearchResultsSectionHeading,
  SearchResultsList,
} from "raft-ui";
import { EntityResultRow } from "../packages/web/src/components/search/EntityResultRow.tsx";
import type { SearchEntity } from "./search-entities.ts";
export function SearchEntityRow({
  entity,
  selected,
  onOpen,
}: {
  entity: SearchEntity;
  selected: boolean;
  onOpen: (entity: SearchEntity, full: boolean) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <div data-entity-id={entity.key}>
      <EntityResultRow
        result={
          entity.type === "agentDm" ? { ...entity, agentId: null } : entity
        }
        selected={selected}
        returnHint={false}
        agentAvatarUrl={null}
        humanMember={undefined}
        onResultContextMenu={() => {}}
        onResultClick={(event) => {
          clearTimeout(timer.current);
          if (event.detail >= 2) onOpen(entity, true);
          else timer.current = setTimeout(() => onOpen(entity, false), 220);
        }}
      />
    </div>
  );
}
export default function SearchEntityRows({
  entities,
  selectedId,
  onOpen,
}: {
  entities: SearchEntity[];
  selectedId: string | null;
  onOpen: (entity: SearchEntity, full: boolean) => void;
}) {
  const { formatMessage } = useIntl();
  if (!entities.length) return null;
  return (
    <SearchResultsSection className="mb-3 px-3">
      <SearchResultsSectionHeading>
        {formatMessage({ id: "search.serverEntities" })}
      </SearchResultsSectionHeading>
      <SearchResultsList
        data-testid="search-entity-results"
        className="-m-1.5 max-h-[24rem] overflow-y-auto overscroll-contain p-1.5"
      >
        {entities.map((entity) => (
          <SearchEntityRow
            key={entity.key}
            entity={entity}
            selected={selectedId === entity.key}
            onOpen={onOpen}
          />
        ))}
      </SearchResultsList>
    </SearchResultsSection>
  );
}
