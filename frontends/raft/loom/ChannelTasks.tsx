import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { ThreadIcon } from "raft-ui";
import { useIntl } from "react-intl";
import MenuItem from "../packages/web/src/components/ui/MenuItem.tsx";
import type { Message } from "../packages/web/src/store/messageStore.ts";
import type { Task } from "../packages/web/src/store/taskStore.ts";
import type { GlobalTasksResponse } from "@rah-os/protocol";
import { ChannelTaskClient } from "./channel-task-client.ts";
import type { LoomChannelClient } from "./channel-client.ts";
import { toOfficialTask } from "./task-client.ts";
import {
  useIntentRoute,
  useRouteIntentOwner,
  hasRouteBoundIntent,
} from "./useIntentRoute.ts";
import TaskDetail from "./TaskDetail.tsx";
export const ChannelTasksContext = createContext<{
  roomId: string;
  tasks: Task[];
  complete: boolean;
  disabled: boolean;
  convert: (id: string) => void;
  open: (id: string) => void;
  thread: (id: string) => void;
} | null>(null);
const noTasks: Task[] = [];
/** Same Room read projection for all message bodies, including thread replies. */
export function useLoomTaskReferences(roomId: string) {
  const actions = useContext(ChannelTasksContext);
  const scoped = actions?.roomId === roomId ? actions : undefined;
  return {
    tasks: scoped?.tasks ?? noTasks,
    openNumber: scoped
      ? (number: number) => {
          const task = scoped.tasks.find(
            (t) => t.taskNumber === number && t.channelId === roomId,
          );
          if (task) scoped.open(task.id);
        }
      : undefined,
  };
}
export function useLoomTaskActions(message: Message, topLevel = true) {
  const actions = useContext(ChannelTasksContext);
  if (
    !topLevel ||
    !actions ||
    message.channelId !== actions.roomId ||
    message.messageType === "system"
  )
    return undefined;
  return {
    ...actions,
    messageId: message.id,
    task: actions.tasks.find((t) => t.messageId === message.id),
  };
}
export function LoomTaskMenu({
  actions,
  close,
}: {
  actions: ReturnType<typeof useLoomTaskActions>;
  close: () => void;
}) {
  const { formatMessage } = useIntl();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [close]);
  if (!actions) return null;
  return (
    <>
      <MenuItem
        icon={<ThreadIcon width={14} height={14} />}
        disabled={actions.disabled}
        onClick={() => {
          close();
          actions.thread(actions.messageId);
        }}
      >
        {formatMessage({ id: "message.messageItem.openThread" })}
      </MenuItem>
      <MenuItem
        icon={<ClipboardCheck size={14} />}
        disabled={actions.disabled || (!actions.task && !actions.complete)}
        title={
          !actions.task && !actions.complete
            ? "任务信息尚未完整读取，请从任务页查看"
            : undefined
        }
        onClick={() => {
          close();
          if (actions.task) actions.open(actions.task.id);
          else actions.convert(actions.messageId);
        }}
      >
        {actions.task
          ? "打开任务"
          : formatMessage({ id: "message.messageItem.convertToTask" })}
      </MenuItem>
    </>
  );
}
/** A bounded read projection; all mutations share the existing channel slot. */
export function useChannelTasks(
  bridge: LoomChannelClient,
  enabled: boolean,
  onChanged: () => void,
  onThread: (id: string) => void,
) {
  const facade = useMemo(() => new ChannelTaskClient(bridge), [bridge]);
  useRouteIntentOwner(bridge.writes, "task-create");
  const [params, setParams] = useIntentRoute();
  const [rows, setRows] = useState<GlobalTasksResponse["tasks"]>([]),
    [complete, setComplete] = useState(false),
    [tick, setTick] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setComplete(false);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const room = bridge.room.state.snapshot?.room;
        if (!room) return;
        const result = await bridge.client.request(
          "task.global.list",
          {
            workspaceId: room.workspaceId,
            roomIds: [bridge.roomId],
            limit: 100,
          },
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setRows(result.tasks);
          setComplete(!result.nextCursor);
        }
      } catch {
        if (!controller.signal.aborted) {
          setRows([]);
          setComplete(false);
        }
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(read, 5000);
      }
    };
    void read();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [bridge, enabled, tick]);
  const changed = () => {
    setTick((v) => v + 1);
    onChanged();
  };
  const open = (id: string) => {
    if (hasRouteBoundIntent()) return;
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set("task", id);
      next.set("taskChannel", bridge.roomId);
      return next;
    });
  };
  const taskId = params.get("task"),
    taskRoom = params.get("taskChannel");
  return {
    facade,
    error,
    changed,
    context: enabled
      ? {
          roomId: bridge.roomId,
          tasks: rows.map((r) =>
            toOfficialTask(
              r.task,
              r.roomName,
              bridge.room.state.snapshot?.members ?? [],
            ),
          ),
          complete,
          disabled: bridge.writes.state !== "idle",
          thread: onThread,
          open,
          convert: (id: string) => {
            setError("");
            void facade
              .convert(id, (result) => {
                if (result.kind === "ok") changed();
                else if (result.kind === "rejected")
                  setError(
                    "转为任务被拒绝，请刷新后重试；已有任务可从任务页打开。",
                  );
              })
              .catch(() => setError("无法转为任务，请重新读取频道。"));
          },
        }
      : null,
    detail:
      taskId &&
      taskRoom === bridge.roomId &&
      (!params.get("view") || params.get("view") === "channels") ? (
        <TaskDetail
          key={taskId}
          client={bridge.client}
          roomId={bridge.roomId}
          taskId={taskId}
          canManage={
            rows.find((r) => r.task.taskId === taskId)?.canManageAnyTask ??
            false
          }
          onChanged={changed}
          onClose={() => {
            if (hasRouteBoundIntent()) return;
            setParams((p) => {
              const next = new URLSearchParams(p);
              next.delete("task");
              next.delete("taskChannel");
              return next;
            });
          }}
        />
      ) : null,
  };
}
