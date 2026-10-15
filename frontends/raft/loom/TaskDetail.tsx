import { useEffect, useMemo, useState, useRef } from "react";
import { Button } from "raft-ui";
import CloseButton from "../packages/web/src/components/ui/CloseButton.tsx";
import { ArrowLeft, X } from "lucide-react";
import type { RahClient } from "@rah-os/client-sdk";
import type { TaskWorkflowStatus } from "@rah-os/protocol";
import Modal from "../packages/web/src/components/Modal.tsx";
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
  const mobile = useMediaQuery("(max-width: 767.98px)");
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
  const task = data
    ? toOfficialTask(data.task, data.room?.name ?? "", data.members)
    : undefined;
  const content = (
    <div
      className={
        mobile
          ? "absolute inset-0 z-30 flex flex-col bg-layer-panel theme-brutal:bg-white"
          : "flex h-[min(86vh,900px)] max-h-[calc(100dvh-2rem)] w-[min(960px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-line-muted bg-layer-popover shadow-raft-xl theme-brutal:rounded-none theme-brutal:border-2 theme-brutal:border-black theme-brutal:bg-white theme-brutal:shadow-brutal"
      }
      data-testid="task-thread-modal"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-line-muted bg-layer-panel px-4 py-2 theme-brutal:border-b-2 theme-brutal:border-black theme-brutal:bg-white">
        {mobile && (
          <Button
            onClick={close}
            aria-label="关闭任务"
            data-testid="task-modal-mobile-back"
            size="icon-sm"
            variant="outline"
            className="size-7 shrink-0"
          >
            <ArrowLeft size={14} />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-foreground-muted">
            {!error && task ? `#${task.channelName}` : "任务"}
          </div>
          <div
            className="truncate text-sm font-bold"
            data-testid="task-modal-bar-label"
          >
            {!error && task ? `任务 #${task.taskNumber}` : "读取任务"}
          </div>
        </div>
        {!mobile && (
          <CloseButton
            onClick={close}
            aria-label="关闭任务"
            data-testid="task-modal-close"
            className="flex size-7 shrink-0 items-center justify-center"
          >
            <X size={14} />
          </CloseButton>
        )}
      </div>
      {state === "unknown" && (
        <div role="alert" className="p-3 text-sm">
          状态修改结果未知。
          <Button onClick={() => void bridge.writes.retry()}>
            核实状态修改
          </Button>
        </div>
      )}
      {writeError && (
        <div role="alert" className="p-3 text-sm">
          {writeError}
        </div>
      )}
      {data?.room && task ? (
        <TaskActions.Provider
          value={{
            canManage,
            disabled: state !== "idle" || !!error || !!data.room.archivedAt,
            update,
          }}
        >
          <ThreadWorkspace
            key={data.task.sourceMessageId}
            client={client}
            room={data.room}
            rootMessageId={data.task.sourceMessageId}
            embedded
            taskHead={<TaskModalHead task={task} />}
            readError={error}
            onClose={close}
            onChanged={onChanged}
          />
        </TaskActions.Provider>
      ) : (
        <div className="p-4" role={error ? "alert" : "status"}>
          {error || "加载中…"}
        </div>
      )}
    </div>
  );
  return mobile ? (
    content
  ) : (
    <Modal onClose={close} closeOnBackdrop>
      {content}
    </Modal>
  );
}
