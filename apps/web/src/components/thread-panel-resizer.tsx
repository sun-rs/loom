import {
  PanelResizer,
  type PanelResizeProps,
} from "@rah-os/ui-web/neo-brutalist/panel-resizer";
import {
  clampThreadPanelWidth,
  nextThreadPanelWidth,
  RAFT_THREAD_PANEL_MIN_WIDTH,
  threadPanelMaxWidth,
} from "../thread-panel-resize.ts";

export function ThreadPanelResizer({
  inspector = false,
  ...props
}: PanelResizeProps & { inspector?: boolean }) {
  return (
    <PanelResizer
      {...props}
      label={inspector ? "调整 Agent 资料面板宽度" : "调整消息列宽度"}
      className={inspector ? "rah-agent-profile-resizer" : "rah-thread-resizer"}
      direction={-1}
      min={RAFT_THREAD_PANEL_MIN_WIDTH}
      max={threadPanelMaxWidth(window.innerWidth)}
      clamp={(width) => clampThreadPanelWidth(width, window.innerWidth)}
      nextWidth={(width, key) =>
        nextThreadPanelWidth(width, key, window.innerWidth)
      }
      testId={
        inspector
          ? "conversation-inspector-resizer"
          : "thread-side-column-resizer"
      }
      highlight={false}
    />
  );
}
