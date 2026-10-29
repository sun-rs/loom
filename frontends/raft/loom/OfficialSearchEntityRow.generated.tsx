// GENERATED from locked db5e399 official source. Imports bind Loom; explicit compatibility patches only.
import { useCallback } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useIntl } from "react-intl";
import { Monitor } from "lucide-react";
import {
  Badge,
  Kbd,
  SearchEntityResult,
  SearchEntityResultContent,
  SearchEntityResultDescription,
  SearchEntityResultHeader,
  SearchEntityResultIcon,
  SearchEntityResultLeading,
  SearchEntityResultTitle,
} from "raft-ui";
import AgentActivityDot from "../packages/web/src/components/agent/AgentActivityDot";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot";
import { ARCHIVED_CHANNEL_ICON_CLASS } from "../packages/web/src/components/channel/channelArchiveVisual";
import { ChannelKindIcon } from "../packages/web/src/components/channel/channelKindIcon";
import type { SearchEntityResult as SearchEntityRecord } from "../packages/web/src/components/search/searchEntities";
import { formatEntitySubtitle, RETURN_KEY_GLYPH } from "../packages/web/src/components/search/MessageSearchPage";
import type { SearchSenderMember } from "../packages/web/src/components/search/MessageSearchPage";
export function EntityResultRow({
  result,
  rootRef,
  returnHint,
  selected,
  agentAvatarUrl,
  humanMember,
  onResultContextMenu,
  onResultClick,
}: {
  result: SearchEntityRecord;
  rootRef?: import("react").Ref<HTMLDivElement>;
  returnHint: boolean;
  selected: boolean;
  agentAvatarUrl: string | null;
  humanMember: SearchSenderMember | undefined;
  onResultContextMenu: (event: ReactMouseEvent, result: SearchEntityRecord) => void;
  onResultClick: (event: ReactMouseEvent<HTMLButtonElement>, result: SearchEntityRecord) => void;
}) {
  const { formatMessage } = useIntl();
  const handleContextMenu = useCallback(
    (event: ReactMouseEvent) => onResultContextMenu(event, result),
    [onResultContextMenu, result],
  );
  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => onResultClick(event, result),
    [onResultClick, result],
  );
  const channelPinnedRef = result.type === "channel" && result.channelId
    ? { kind: "channel", id: result.channelId } as const
    : null;
  const isArchivedChannelResult = result.type === "channel" && !!result.archivedAt;

  // Official SearchEntityResult owns the list-cell frame and states; wrapper binds only identity and events.
  return (
    <div
      ref={rootRef}
      data-entity-id={result.key}
      data-testid={channelPinnedRef ? `search-channel-result-${channelPinnedRef.id}` : undefined}
      data-active={selected ? "true" : undefined}
      onContextMenu={channelPinnedRef && !result.archivedAt ? handleContextMenu : undefined}
      className="relative flex w-full"
    >
      <SearchEntityResult
        type="button"
        onClick={handleClick}
        selected={selected}
      >
        <SearchEntityResultLeading>
          {result.type === "channel" ? (
            <SearchEntityResultIcon
              className={isArchivedChannelResult ? ARCHIVED_CHANNEL_ICON_CLASS : undefined}
            >
              <ChannelKindIcon type={result.channelType ?? "channel"} />
            </SearchEntityResultIcon>
          ) : result.type === "computer" ? (
            <SearchEntityResultIcon>
              <Monitor size={14} aria-hidden="true" />
            </SearchEntityResultIcon>
          ) : result.type === "agentDm" ? (
            result.agentId ? (
              <AvatarSlot
                context="compact-row"
                type="agent"
                agentAvatarUrl={agentAvatarUrl}
                badge={<AgentActivityDot agentId={result.agentId} />}
              />
            ) : (
              <AvatarSlot context="compact-row" type="agent" agentAvatarUrl={null} />
            )
          ) : result.userId ? (
            <AvatarSlot
              context="compact-row"
              type="human"
              humanAvatarUrl={humanMember?.avatarUrl}
              gravatarHash={humanMember?.gravatarHash}
            />
          ) : (
            <AvatarSlot context="compact-row" type="human" humanPlaceholder />
          )}
        </SearchEntityResultLeading>
        <SearchEntityResultContent>
          <SearchEntityResultHeader>
            <SearchEntityResultTitle className="truncate" muted={isArchivedChannelResult}>
              {result.title}
            </SearchEntityResultTitle>
            {/* The kind is a machine label after the name (DS `rf-tag`), not a
                coloured chip: identity comes from the tile/avatar. */}
            <Badge appearance="outline">
              {result.type === "channel" ? formatMessage({ id: "search.channel" }) : result.type === "computer" ? formatMessage({ id: "search.badgeComputer" }) : result.type === "agentDm" ? formatMessage({ id: "search.badgeAgent" }) : formatMessage({ id: "search.badgeHuman" })}
            </Badge>
            {result.archivedAt && (
              <Badge
                appearance={isArchivedChannelResult ? "outline" : "soft"}
                variant={isArchivedChannelResult ? undefined : "warning"}
              >
                {formatMessage({ id: "search.archived" })}
              </Badge>
            )}
          </SearchEntityResultHeader>
          <SearchEntityResultDescription muted={isArchivedChannelResult}>
            {formatEntitySubtitle(result.subtitle, formatMessage)}
          </SearchEntityResultDescription>
        </SearchEntityResultContent>
        {returnHint && selected ? <Kbd aria-hidden="true">{RETURN_KEY_GLYPH}</Kbd> : null}
      </SearchEntityResult>
    </div>
  );
}
