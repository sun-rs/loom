// GENERATED from locked db5e399 official source. Imports bind Loom; explicit compatibility patches only.
import {IconTile, DirectMessageIcon, ThreadIcon} from "raft-ui";
import {Hash} from "lucide-react";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot";
type Channel = {peerType: "agent" | "user"; peerAvatarUrl?: string | null; peerGravatarHash?: string | null};
function ConversationAvatar({ kind, dmChannel }: { kind: "thread" | "dm" | "channel"; dmChannel: Channel | null }) {
  if (kind === "dm" && dmChannel) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center" data-testid="conversation-card-avatar" data-kind="dm">
        {dmChannel.peerType === "agent" ? (
          <AvatarSlot context="panel-header" type="agent" agentAvatarUrl={dmChannel.peerAvatarUrl ?? null} />
        ) : (
          <AvatarSlot
            context="panel-header"
            type="human"
            humanAvatarUrl={dmChannel.peerAvatarUrl ?? null}
            gravatarHash={dmChannel.peerGravatarHash ?? null}
            humanPlaceholder={!dmChannel.peerAvatarUrl && !dmChannel.peerGravatarHash}
          />
        )}
      </div>
    );
  }
  return (
    <span className="relative flex size-9 shrink-0 items-center justify-center" data-testid="conversation-card-avatar" data-kind={kind}>
      {/* A channel is a place, not a face: the neutral DS channel tile
          (raft-ui IconTile, the 35px avatar step of the DM faces). */}
      <IconTile>
        {kind === "dm" ? <DirectMessageIcon /> : <Hash />}
      </IconTile>
      {kind === "thread" ? (
        <span className="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-sticker border border-line-seam bg-layer-card text-foreground-muted">
          <ThreadIcon width={11} height={11} />
        </span>
      ) : null}
    </span>
  );
}
export default ConversationAvatar;
