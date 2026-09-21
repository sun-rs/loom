import {
  PanelResizer,
  type PanelResizeProps,
} from "@rah-os/ui-web/neo-brutalist/panel-resizer";
import {
  clampProfilePanelWidth,
  nextProfilePanelWidth,
  RAFT_PROFILE_PANEL_MIN_WIDTH,
  RAFT_PROFILE_PANEL_MAX_WIDTH,
} from "../profile-panel-resize.ts";

export function ProfilePanelResizer({
  conversation = false,
  ...props
}: PanelResizeProps & { conversation?: boolean }) {
  return (
    <PanelResizer
      {...props}
      measureParent
      highlight={!conversation}
      {...(conversation ? { testId: "conversation-inspector-resizer" } : {})}
      label="调整 Agent 资料面板宽度"
      className="rah-agent-profile-resizer"
      direction={-1}
      min={RAFT_PROFILE_PANEL_MIN_WIDTH}
      max={RAFT_PROFILE_PANEL_MAX_WIDTH}
      clamp={clampProfilePanelWidth}
      nextWidth={nextProfilePanelWidth}
    />
  );
}
