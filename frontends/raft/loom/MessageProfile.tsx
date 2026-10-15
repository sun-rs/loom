import { createContext, useContext } from "react";
import type { Principal } from "@rah-os/protocol";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";

// Borrow the mounted timeline's authorized RoomSession projection, including
// through native PreviewCard portals. Never hydrate a second upstream store.
export const MessageProfileMembers = createContext<readonly Principal[]>([]);

/** Structural port of ProfilePreviewCardContent's identity/description blocks.
 * Native PreviewCard owns trigger, timing, portal, geometry and dismissal.
 * Omit unbound presence/runtime/activity rather than interpreting missing data.
 */
export default function MessageProfile({
  mentionType,
  mentionId,
  fallbackLabel,
}: {
  mentionType: "agent" | "user";
  mentionId: string;
  fallbackLabel?: string;
}) {
  const members = useContext(MessageProfileMembers);
  const member = members.find(
    (p) =>
      p.principalId === mentionId &&
      p.kind === (mentionType === "agent" ? "agent" : "human"),
  );
  const name = member?.displayName ?? member?.handle ?? fallbackLabel ?? "成员";
  return (
    <div data-testid="loom-message-profile">
      <div className="flex items-start gap-3 px-3 py-3">
        <AvatarSlot
          context="mention-card"
          type={mentionType === "agent" ? "agent" : "human"}
          humanPlaceholder={mentionType === "user"}
          className="mt-0.5 self-start"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-foreground-strong theme-brutal:text-black">
            {name}
          </div>
          <div className="truncate font-mono text-xs text-foreground-muted theme-brutal:text-black/60">
            {member ? `@${member.handle}` : "成员资料暂不可用"}
          </div>
        </div>
      </div>
      {member?.description ? (
        <Tooltip content={member.description}>
          <div className="truncate border-t-2 border-line-muted theme-brutal:border-black px-3 py-2 text-xs text-foreground-muted theme-brutal:text-black/70">
            {member.description}
          </div>
        </Tooltip>
      ) : null}
    </div>
  );
}
