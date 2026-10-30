import { useLoomAvatarMap } from "./AppearanceRuntime.tsx";
import { createPortal } from "react-dom";
import { FolderOpen } from "lucide-react";
import DismissBackdrop from "../packages/web/src/components/ui/DismissBackdrop.tsx";
import MenuItem from "../packages/web/src/components/ui/MenuItem.tsx";
import { placeContextMenu } from "../packages/web/src/components/ui/contextMenuPosition.ts";
import { useFloatingOverlayPosition } from "../packages/web/src/components/ui/useFloatingOverlayPosition.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import {
  ContextMenuPopup,
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
  returnHint = false,
}: {
  entity: SearchEntity;
  returnHint?: boolean;
  selected: boolean;
  onOpen: (entity: SearchEntity, full: boolean) => void;
}) {
  const avatars = useLoomAvatarMap();
  const { formatMessage } = useIntl();
  const row = useRef<HTMLDivElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    anchorX: number;
    anchorY: number;
  }>();
  const anchor = useMemo(
    () => (menu ? { x: menu.anchorX, y: menu.anchorY } : null),
    [menu?.anchorX, menu?.anchorY],
  );
  const onPositionChange = useCallback((position: { x: number; y: number }) => {
    setMenu((current) =>
      !current || (current.x === position.x && current.y === position.y)
        ? current
        : { ...current, ...position },
    );
  }, []);
  useFloatingOverlayPosition({
    open: Boolean(menu),
    anchor,
    floatingRef,
    onPositionChange,
  });
  const close = () => {
    setMenu(undefined);
    row.current?.querySelector("button")?.focus({ preventScroll: true });
  };
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <>
      <EntityResultRow
        rootRef={row}
        result={
          entity.type === "agentDm" ? { ...entity, agentId: null } : entity
        }
        selected={selected || Boolean(menu)}
        returnHint={returnHint}
        agentAvatarUrl={
          entity.type === "agentDm" && entity.agentId
            ? (avatars[entity.agentId] ?? null)
            : null
        }
        humanMember={undefined}
        onResultContextMenu={(event) => {
          clearTimeout(timer.current);
          event.preventDefault();
          event.stopPropagation();
          setMenu({
            ...placeContextMenu({
              x: event.clientX,
              y: event.clientY,
              width: 192,
              height: 40,
            }),
            anchorX: event.clientX,
            anchorY: event.clientY,
          });
        }}
        onResultClick={(event) => {
          clearTimeout(timer.current);
          if (event.detail >= 2) onOpen(entity, true);
          else timer.current = setTimeout(() => onOpen(entity, false), 220);
        }}
      />
      {menu &&
        createPortal(
          <>
            <DismissBackdrop onDismiss={close} trapContextMenu />
            <ContextMenuPopup
              role="menu"
              aria-label={formatMessage(
                { id: "search.channelMenuAria" },
                { title: entity.title },
              )}
              ref={(node) => {
                floatingRef.current = node;
                node?.querySelector<HTMLButtonElement>("button")?.focus();
              }}
              className="fixed z-50 w-48 select-none"
              style={{ left: menu.x, top: menu.y }}
              onMouseDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  close();
                }
              }}
            >
              <MenuItem
                icon={<FolderOpen size={14} />}
                onClick={() => {
                  setMenu(undefined);
                  onOpen(entity, true);
                }}
              >
                {formatMessage({ id: "search.open" })}
              </MenuItem>
            </ContextMenuPopup>
          </>,
          document.body,
        )}
    </>
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
    <SearchResultsSection>
      <SearchResultsSectionHeading>
        {formatMessage({ id: "search.serverEntities" })}
      </SearchResultsSectionHeading>
      <SearchResultsList
        data-testid="search-entity-results"
        className="max-h-[24rem] overflow-y-auto overscroll-contain"
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
