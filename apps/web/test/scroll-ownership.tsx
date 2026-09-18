import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { AgentActivityPane } from "../src/components/agent-directory-pane.tsx";
import { useThreadFocusReturn } from "../src/thread-focus-return.ts";
import { useSearchChannelPreview } from "../src/use-search-channel-preview.ts";
import { useTaskInitialScroll } from "../src/use-task-initial-scroll.ts";
import "@rah-os/ui-tokens/styles.css";
import "../src/product.css";
import "../src/agent-directory.css";

const agent: WorkspaceAgentView = {
  agentDefinitionId: "fixture",
  createdAt: "2026-09-16T00:00:00Z",
  createdBy: "fixture",
  displayName: "Fixture",
  handle: "fixture",
  participantId: "fixture",
  executionPolicyRevisionId: "fixture",
  role: "member",
  runtimeAvailable: false,
  runtimeLabels: [],
  skillRefs: [],
  state: "active",
};
const activity = (i: number): RuntimeTrajectoryRecord => ({
  activityId: `fixture-${i}`,
  entry: {
    kind: "tool_start",
    producerFactId: `fixture-${i}`,
    toolName: `fixture_tool_${i}`,
    toolInput: "",
  },
  observedAt: agent.createdAt,
  recordedAt: agent.createdAt,
  participantId: "fixture",
  producerSequence: i,
  serverSequence: i,
  roomId: "fixture",
  context: { roomId: "fixture", roomName: "fixture-room", roomKind: "channel" },
  runAttemptId: "fixture",
  runtimeRunId: "fixture",
});
function Fixture() {
  const taskScroll = useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = useState(1000);
  useTaskInitialScroll(taskScroll, "fixture-task");
  const [activities, setActivities] = useState(() =>
    Array.from({ length: 80 }, (_, i) => activity(i)),
  );
  const [activityHistory, setActivityHistory] = useState(false);
  const [open, setOpen] = useState("");
  const thread = useThreadFocusReturn();
  const search = useSearchChannelPreview();
  return (
    <>
      <button onClick={() => setContentHeight(1500)}>
        Resize task content
      </button>
      <div
        ref={taskScroll}
        data-testid="task-initial-scroll"
        style={{ height: 200, overflow: "auto" }}
      >
        <div style={{ height: contentHeight }}>Task detail content</div>
      </div>
      <button
        onClick={() => {
          const scroll = document.querySelector<HTMLElement>(
            ".rah-agent-activity-pane",
          )!;
          scroll.scrollTop -= 200;
          flushSync(() =>
            setActivities((old) => [...old, activity(old.length)]),
          );
        }}
      >
        Scroll and append diagnostic
      </button>
      <div style={{ height: 300, display: "flex" }}>
        <AgentActivityPane
          agent={agent}
          activities={activities}
          error={undefined}
          hasEarlier={new URLSearchParams(location.search).has(
            "activityRepair",
          )}
          loading={false}
          history={activityHistory}
          onLatest={() => {
            setActivityHistory(false);
            setActivities(Array.from({ length: 80 }, (_, i) => activity(i)));
          }}
          onLoadEarlier={() => {
            setActivityHistory(true);
            setActivities((current) => [
              ...Array.from({ length: 20 }, (_, i) =>
                activity(current[0]!.serverSequence - 20 + i),
              ),
              ...current,
            ]);
          }}
          onOpenRoom={() => {}}
        />
      </div>
      <div data-testid="focus-scroll" style={{ height: 200, overflow: "auto" }}>
        <button
          onClick={(e) => {
            thread.rememberThreadFocus(e.currentTarget);
            setOpen("thread");
          }}
        >
          Open thread
        </button>
        <button
          onClick={() => {
            search.open("fixture");
            setOpen("search");
          }}
        >
          Open search preview
        </button>
        <div style={{ height: 1000 }}>Scrollable content</div>
      </div>
      {open && (
        <button
          onClick={() => {
            if (open === "thread") thread.restoreThreadFocus();
            else search.close();
            setOpen("");
          }}
        >
          Close preview
        </button>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
