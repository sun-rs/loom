// GENERATED from locked db5e399 official source. Imports bind Loom; explicit compatibility patches only.
import { useCallback } from "react";
import { useIntl } from "react-intl";
import { Monitor } from "lucide-react";
import {
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
import { ChannelKindIcon } from "../packages/web/src/components/channel/channelKindIcon";
import type { SearchEntityResult as SearchEntityRecord } from "../packages/web/src/components/search/searchEntities";
import { formatEntitySubtitle } from "../packages/web/src/components/search/MessageSearchPage";
import type { SearchSenderMember } from "../packages/web/src/components/search/MessageSearchPage";
export function SearchHomeEntityRow({
  result,
  agentAvatarUrl,
  humanMember,
  onActivate,
}: {
  result: SearchEntityRecord;
  agentAvatarUrl: string | null;
  humanMember: SearchSenderMember | undefined;
  onActivate: (result: SearchEntityRecord) => void;
}) {
  const { formatMessage } = useIntl();
  const handleClick = useCallback(() => onActivate(result), [onActivate, result]);

  return (
    <SearchEntityResult
      type="button"
      data-testid={`search-common-${result.key}`}
      onClick={handleClick}
    >
      <SearchEntityResultLeading>
        {result.type === "channel" ? (
          <SearchEntityResultIcon>
            <ChannelKindIcon type={result.channelType ?? "channel"} />
          </SearchEntityResultIcon>
        ) : result.type === "computer" ? (
          <SearchEntityResultIcon>
            <Monitor size={14} />
          </SearchEntityResultIcon>
        ) : result.type === "agentDm" ? (
          <AvatarSlot
            context="compact-row"
            type="agent"
            agentAvatarUrl={agentAvatarUrl}
            badge={result.agentId ? <AgentActivityDot agentId={result.agentId} /> : undefined}
          />
        ) : (
          <AvatarSlot
            context="compact-row"
            type="human"
            humanAvatarUrl={humanMember?.avatarUrl}
            gravatarHash={humanMember?.gravatarHash}
          />
        )}
      </SearchEntityResultLeading>
      <SearchEntityResultContent>
        <SearchEntityResultHeader>
          <SearchEntityResultTitle>{result.title}</SearchEntityResultTitle>
        </SearchEntityResultHeader>
        <SearchEntityResultDescription>
          {formatEntitySubtitle(result.subtitle, formatMessage)}
        </SearchEntityResultDescription>
      </SearchEntityResultContent>
    </SearchEntityResult>
  );
}
