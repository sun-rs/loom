import { useLoomMessageState } from "./AppearanceRuntime.tsx";
import { Status } from "raft-ui";
export { boundMessageMentions } from "./member-roster.ts";
import { projectMessageMentions } from "./member-roster.ts";
import { createContext, useContext, useMemo } from "react";
import { Separator } from "raft-ui";
import type { Principal } from "@rah-os/protocol";
import AvatarSlot from "../packages/web/src/components/ui/AvatarSlot.tsx";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";

// Borrow the mounted timeline's authorized RoomSession projection, including
// through native PreviewCard portals. Never hydrate a second upstream store.
export const MessageProfileMembers = createContext<readonly Principal[]>([]);
export const MessageStatusRoom = createContext<string | undefined>(undefined);
export function useMessageInstanceState(agentId: string) {
  return useLoomMessageState(useContext(MessageStatusRoom) ?? "", agentId);
}
export function MessageInstanceStatusDot({ agentId }: { agentId: string }) {
  const state = useMessageInstanceState(agentId);
  if (state === "unknown" || state === "left") return null;
  const labels = {
    working: "运行中",
    waking: "排队或启动中",
    idle: "空闲（无正在执行的工作）",
    error: "执行错误",
  };
  const tones = {
    working: "bg-presence-online",
    waking: "bg-presence-busy",
    idle: "bg-presence-offline",
    error: "bg-danger",
  };
  return (
    <Tooltip content={labels[state]}>
      <Status
        size="lg"
        className={tones[state]}
        aria-label={labels[state]}
        data-testid="message-instance-status"
        data-state={state}
      />
    </Tooltip>
  );
}
export function useMessageMentionMap() {
  const members = useContext(MessageProfileMembers);
  return useMemo(() => projectMessageMentions(members), [members]);
}

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
      <div className="flex items-start gap-3 px-4 pt-4 pb-3 last:pb-4">
        <AvatarSlot
          context="mention-card"
          type={mentionType === "agent" ? "agent" : "human"}
          humanPlaceholder={mentionType === "user"}
          className="mt-0.5 self-start"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-headline text-foreground">{name}</div>
          <div className="truncate font-mono text-mono-meta text-foreground-muted">
            {member ? `@${member.handle}` : "成员资料暂不可用"}
          </div>
        </div>
      </div>
      {member?.description ? (
        <>
          <Separator />
          <Tooltip content={member.description}>
            <div className="truncate px-4 py-3 last:pb-4 text-callout text-foreground-muted">
              {member.description}
            </div>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}
