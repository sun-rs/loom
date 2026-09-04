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

export function ThreadPanelResizer(props: PanelResizeProps) {
  return (
    <PanelResizer
      {...props}
      label="调整消息列宽度"
      className="rah-thread-resizer"
      direction={-1}
      min={RAFT_THREAD_PANEL_MIN_WIDTH}
      max={threadPanelMaxWidth(window.innerWidth)}
      clamp={(width) => clampThreadPanelWidth(width, window.innerWidth)}
      nextWidth={(width, key) =>
        nextThreadPanelWidth(width, key, window.innerWidth)
      }
      testId="thread-side-column-resizer"
      highlight={false}
    />
  );
}
