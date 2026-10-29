import {
  OfficialTaskHeadObserver,
  OfficialTaskHeadPullDown,
  OfficialCompactTaskSummary,
} from "./OfficialTaskHead138.generated.js";
import { layoutQueries } from "./adaptive-layout.ts";
import {
  OfficialTaskSurface,
  OfficialTaskModalBar,
  OfficialTaskReadBar,
} from "./OfficialTaskSurfaces.generated";
import { uiActionProps } from "./ui-action-props.ts";
import TaskHistory from "./TaskHistory.tsx";
import {
  useEffect,
  useMemo,
  useState,
  useRef,
  useId,
  useCallback,
} from "react";
import { Button } from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import type { TaskWorkflowStatus } from "@rah-os/protocol";
import TaskModalHead from "../packages/web/src/components/task/TaskModalHead.tsx";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import { LoomTaskClient, toOfficialTask } from "./task-client.ts";
import { TaskActions } from "./TaskProperties.tsx";
import ThreadWorkspace from "./ThreadWorkspace.tsx";
import { useRouteIntentOwner, hasRouteBoundIntent } from "./useIntentRoute.ts";
export default function TaskDetail({
  client,
  roomId,
  taskId,
  canManage,
  onClose,
  onChanged,
}: {
  client: RahClient;
  roomId: string;
  taskId: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const bridge = useMemo(
    () => new LoomTaskClient(client, roomId, taskId),
    [client, roomId, taskId],
  );
  useRouteIntentOwner(bridge.writes);
  const [data, setData] =
    useState<Awaited<ReturnType<LoomTaskClient["refresh"]>>>();
  const [error, setError] = useState(""),
    [writeError, setWriteError] = useState(""),
    [state, setState] = useState(bridge.writes.state),
    [tick, setTick] = useState(0);
  const mobile = useMediaQuery(layoutQueries.single);
  const [headInView, setHeadInView] = useState(true),
    [headPanelOpen, setHeadPanelOpen] = useState(false);
  const headId = useId(),
    headBar = useRef<HTMLButtonElement>(null);
  const closeHead = useCallback(() => setHeadPanelOpen(false), []);
  useEffect(() => {
    if (headInView || !mobile) setHeadPanelOpen(false);
  }, [headInView, mobile]);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      const element = opener.current;
      requestAnimationFrame(() => {
        if (element?.isConnected) element.focus({ preventScroll: true });
      });
    };
  }, []);
  useEffect(() => {
    const stop = bridge.writes.onChange(setState);
    return () => {
      stop();
      bridge.writes.discard();
    };
  }, [bridge]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const next = await bridge.refresh(controller.signal);
        if (!controller.signal.aborted) {
          setData(next);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted) setError("任务暂时无法读取，请重试。");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 3000);
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [bridge, tick]);
  const close = () => {
    if (!hasRouteBoundIntent()) onClose();
  };
  const update = (workflowStatus: TaskWorkflowStatus) => {
    if (state !== "idle" || error) return;
    setWriteError("");
    void bridge
      .update(workflowStatus, (outcome) => {
        if (outcome.kind === "ok") {
          setTick((v) => v + 1);
          onChanged();
        } else if (outcome.kind === "rejected")
          setWriteError("状态修改被拒绝，请刷新任务后重试。");
      })
      .catch(() => setWriteError("无法修改任务状态，请重新读取。"));
  };
  const assign = (id: string | null) => {
    if (state !== "idle" || error) return;
    setWriteError("");
    void bridge
      .assign(id, (outcome) => {
        if (outcome.kind === "ok") {
          setTick((v) => v + 1);
          onChanged();
        } else if (outcome.kind === "rejected")
          setWriteError("负责人修改被拒绝，请刷新任务后重试。");
      })
      .catch(() => setWriteError("无法修改负责人，请重新读取。"));
  };
  const task = data
    ? toOfficialTask(data.task, data.room?.name ?? "", data.members)
    : undefined;
  const content = (
    <OfficialTaskSurface
      mobile={mobile}
      onClose={close}
      header={
        !error && task ? (
          <div className="relative z-30 shrink-0">
            <OfficialTaskModalBar
              task={task}
              onClose={close}
              mobile={mobile}
              summary={
                mobile && !headInView ? (
                  <OfficialCompactTaskSummary
                    task={task}
                    id={headId}
                    barRef={headBar}
                    open={headPanelOpen}
                    onOpenChange={setHeadPanelOpen}
                  />
                ) : undefined
              }
            />
            {mobile && !headInView && headPanelOpen && (
              <OfficialTaskHeadPullDown
                id={headId}
                label={`任务 #${task.taskNumber}`}
                barRef={headBar}
                onClose={closeHead}
              >
                <TaskModalHead task={task} />
              </OfficialTaskHeadPullDown>
            )}
          </div>
        ) : (
          <OfficialTaskReadBar
            mobile={mobile}
            onClose={close}
            label={error ? "任务" : "读取任务"}
          />
        )
      }
    >
      {state === "unknown" && (
        <div role="alert" className="p-3 text-sm">
          {bridge.writes.current?.action === "task-assignment"
            ? "负责人修改结果未知。"
            : "状态修改结果未知。"}
          <Button
            {...uiActionProps.recovery}
            onClick={() => void bridge.writes.retry()}
          >
            {bridge.writes.current?.action === "task-assignment"
              ? "核实负责人修改"
              : "核实状态修改"}
          </Button>
        </div>
      )}
      {writeError && (
        <div role="alert" className="p-3 text-sm">
          {writeError}
        </div>
      )}
      {data?.room && task ? (
        <ThreadWorkspace
          key={data.task.sourceMessageId}
          client={client}
          room={data.room}
          rootMessageId={data.task.sourceMessageId}
          embedded
          taskHead={
            <OfficialTaskHeadObserver onChange={setHeadInView}>
              <TaskModalHead task={task} />
            </OfficialTaskHeadObserver>
          }
          readError={error}
          onClose={close}
          onChanged={onChanged}
        />
      ) : (
        <div className="p-4" role={error ? "alert" : "status"}>
          {error || "加载中…"}
        </div>
      )}
    </OfficialTaskSurface>
  );
  return (
    <TaskActions.Provider
      value={{
        canManage,
        disabled:
          !data || state !== "idle" || !!error || !!data.room?.archivedAt,
        update,
        assign,
        canAssign:
          canManage ||
          Boolean(data && data.task.creatorId === data.principal?.principalId),
        members: data?.members,
        history: (
          <TaskHistory
            client={client}
            roomId={roomId}
            taskId={taskId}
            taskNumber={data?.task.taskNumber ?? 0}
            members={data?.members ?? []}
            revision={data?.task.updatedAt ?? ""}
          />
        ),
      }}
    >
      {content}
    </TaskActions.Provider>
  );
}
