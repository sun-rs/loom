import { ChoiceRow } from "@rah-os/ui-web/neo-brutalist/choice-row";
import type { ComposerChannel } from "../composer-mention.ts";

export function ChannelMentionRow({
  channel,
  current,
  id,
  onSelect,
}: {
  channel: ComposerChannel;
  current: boolean;
  id: string;
  onSelect: () => void;
}) {
  return (
    <ChoiceRow
      profile="channel-autocomplete"
      archived={!!channel.archivedAt}
      current={current}
      aria-selected={current}
      role="option"
      id={id}
      className="rah-channel-mention-row"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
    >
      <span className="rah-channel-mention-icon" aria-hidden="true">
        #
      </span>
      <span className="rah-channel-mention-copy">
        <span>{channel.name}</span>
        {channel.description && <small>{channel.description}</small>}
      </span>
      {channel.archivedAt && (
        <span className="rah-channel-mention-archived">已归档</span>
      )}
    </ChoiceRow>
  );
}
