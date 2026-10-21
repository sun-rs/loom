// GENERATED from original a98ae003 LiveAgentActivityBar presentation, not current db5e399.
// Preserves previously adopted design-system compatibility; Loom alone supplies actual activity.
import {useIntl} from "react-intl";
import {AvatarImage,LiveAgentActivityBar,LiveAgentActivityBarAvatar,LiveAgentActivityBarContent,LiveAgentActivityBarRow,LiveAgentActivityBarText,Status} from "raft-ui";
import type {StatusProps} from "raft-ui";
import type {AgentActivity} from "@botiverse/raft-shared";
import type {LiveAgentActivityItem} from "../packages/web/src/utils/liveAgentActivity";
import {formatActivityTextDescriptor} from "../packages/web/src/utils/activity";
import {AgentAvatar,isCustomAvatar} from "../packages/web/src/components/agent/PixelAvatar";
import Tooltip from "@loom/raft-web-source/Tooltip";
const ACTIVITY_STATUS_VARIANT: Record<AgentActivity, NonNullable<StatusProps["variant"]>> = {
  online: "success",
  thinking: "warning",
  working: "warning",
  error: "danger",
  offline: "default",
};
const ACTIVITY_STATUS_BRUTAL_COLOR: Partial<Record<AgentActivity, string>> = {
  thinking: "",
  working: "",
  error: "",
};
export function LiveAgentActivityBarPresentation({
  latest,
}: {
  latest: LiveAgentActivityItem | null;
}) {
  const { formatMessage } = useIntl();
  if (!latest) return null;
  const text = latest.textDescriptor
    ? formatActivityTextDescriptor(formatMessage, latest.textDescriptor)
    : latest.text;
  const activity = latest.activity ?? "offline";

  return (
    // RUI's brutal recipe pads px-4; production's bar is px-3 — keep brutal
    // pixel-identical while the recipe owns everything else.
    <LiveAgentActivityBar className="">
      <LiveAgentActivityBarRow>
        <LiveAgentActivityBarAvatar className="[&>[data-slot=avatar-fallback]]:hidden">
          {latest.agentAvatarUrl && isCustomAvatar(latest.agentAvatarUrl) ? (
            <AvatarImage src={latest.agentAvatarUrl} alt="" />
          ) : (
            <AgentAvatar avatarUrl={latest.agentAvatarUrl} size={20} className="!h-full !w-full" />
          )}
        </LiveAgentActivityBarAvatar>
        <LiveAgentActivityBarContent>
          <Status
            aria-hidden
            size="md"
            variant={ACTIVITY_STATUS_VARIANT[activity]}
            className={["", ACTIVITY_STATUS_BRUTAL_COLOR[activity]].filter(Boolean).join(" ")}
            data-activity={activity}
          />
          <Tooltip content={text}>
            <LiveAgentActivityBarText data-slot="live-agent-activity-bar-text">{text}</LiveAgentActivityBarText>
          </Tooltip>
        </LiveAgentActivityBarContent>
      </LiveAgentActivityBarRow>
    </LiveAgentActivityBar>
  );
}
