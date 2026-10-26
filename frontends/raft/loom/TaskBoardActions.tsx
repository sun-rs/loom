import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Button } from "raft-ui";
import { useIntl } from "react-intl";
import type { RahClient } from "@rah-os/client-sdk";
import { hasUnresolvedIntents } from "@rah-os/client-core/write-intent";
import {
  taskWorkflowTransitionOptions,
  taskWorkflowStatus,
  type Task as KernelTask,
  type TaskWorkflowStatus,
} from "@rah-os/protocol";
import type { Task } from "../packages/web/src/store/taskStore.ts";
import {
  STATUS_STYLES,
  getTaskStatusOptions,
} from "../packages/web/src/components/task/taskStatusUi.ts";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
import type { ChannelTaskClient } from "./channel-task-client.ts";
import {
  TaskBoardClient,
  canEditBoardTask,
  type TaskBoardRow,
} from "./task-board-client.ts";
const Context = createContext<ReturnType<typeof useTaskBoard> | null>(null);
export const TaskBoardProvider = Context.Provider;
export function useTaskBoard(
  client: RahClient,
  channel: ChannelTaskClient | undefined,
  rows: TaskBoardRow[],
  changed: (task: KernelTask) => void,
) {
  const { formatMessage } = useIntl();
  const [announcement, setAnnouncement] = useState("");
  const bridge = useMemo(
    () => new TaskBoardClient(client, channel),
    [client, channel],
  );
  const [state, setState] = useState(bridge.writes.state),
    [error, setError] = useState("");
  const [principalId, setPrincipalId] = useState<string>();
  useEffect(() => {
    const abort = new AbortController();
    void client
      .request("principal.me", {}, { signal: abort.signal })
      .then((r) => {
        if (!abort.signal.aborted) setPrincipalId(r.principal.principalId);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("无法读取任务操作权限，请重新打开任务页。");
      });
    return () => abort.abort();
  }, [client]);
  useEffect(() => {
    const stop = bridge.writes.onChange(setState);
    return () => {
      stop();
      if (!channel) bridge.writes.discard();
    };
  }, [bridge, channel]);
  const rowFor = (task: Task) =>
    rows.find(
      (r) => r.task.taskId === task.id && r.task.roomId === task.channelId,
    );
  const canEdit = (task: Task) => canEditBoardTask(rowFor(task), principalId);
  const options = (task: Task) => {
    const row = rowFor(task);
    return row && canEdit(task)
      ? taskWorkflowTransitionOptions(task.status, row.canManageAnyTask)
      : [];
  };
  const update = async (task: Task, status: TaskWorkflowStatus) => {
    if (hasUnresolvedIntents() || !canEdit(task) || task.status === status)
      return;
    const row = rowFor(task);
    if (!row) return;
    setError("");
    setAnnouncement("");
    try {
      await bridge.update(row, status, principalId, (result) => {
        if (result.kind === "ok") {
          changed(result.result.task);
          setAnnouncement(
            `任务 ${task.title} 已移至${formatMessage({ id: STATUS_STYLES[taskWorkflowStatus(result.result.task.state)].labelId })}`,
          );
        } else if (result.kind === "rejected")
          setError("任务修改被拒绝；原卡片未移动，请重新读取任务后重试。");
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法修改任务。");
    }
  };
  return {
    bridge,
    announcement,
    state,
    error,
    principalId,
    canEdit,
    options,
    rowFor,
    update,
    clearError: () => setError(""),
  };
}
export function TaskBoardRouteOwner({
  board,
}: {
  board: ReturnType<typeof useTaskBoard>;
}) {
  useRouteIntentOwner(board.bridge.writes);
  return null;
}
export function TaskBoardNotice({
  board,
  reload,
}: {
  board: ReturnType<typeof useTaskBoard>;
  reload: () => void;
}) {
  return (
    <>
      <span
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="task-board-announcement"
      >
        {board.announcement}
      </span>
      {board.error && (
        <div role="alert" className="mb-3 text-sm">
          {board.error}
          <Button
            size="sm"
            variant="outline"
            disabled={board.state !== "idle"}
            onClick={() => {
              board.clearError();
              reload();
            }}
          >
            重新读取任务
          </Button>
        </div>
      )}
      {board.state === "unknown" &&
        board.bridge.writes.current?.action === "task-workflow" && (
          <div role="alert" className="mb-3 text-sm">
            未收到任务修改结果，核实前保留原卡片。
            <Button
              size="sm"
              variant="outline"
              onClick={() => void board.bridge.writes.retry()}
            >
              核实任务操作
            </Button>
          </div>
        )}
    </>
  );
}
/** All native cards remain read-only outside the connected page context. */
export function useTaskCardActions(task: Task) {
  const board = useContext(Context),
    { formatMessage } = useIntl();
  const [editingStatus, setEditing] = useState(false);
  const busy = board?.state !== "idle";
  const canEditStatus = Boolean(board?.canEdit(task));
  useEffect(() => {
    if (!editingStatus || busy) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setEditing(false);
      opener?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [editingStatus, busy]);

  return {
    formatMessage,
    editingStatus: editingStatus && !busy,
    busy,
    canEditStatus,
    style: STATUS_STYLES[task.status],
    statusOptions: board
      ? getTaskStatusOptions(
          task,
          board.principalId,
          board.rowFor(task)?.canManageAnyTask ?? false,
        )
          .filter((o) => board.options(task).includes(o.id))
          .map((o) => ({ id: o.id, label: formatMessage({ id: o.labelId }) }))
      : [],
    async handleStatusSelect(id: string) {
      if (busy || !canEditStatus) return;
      setEditing(false);
      await board?.update(task, id as TaskWorkflowStatus);
    },
    toggleStatusEditor() {
      if (!busy && canEditStatus) setEditing((v) => !v);
    },
    closeStatusEditor() {
      setEditing(false);
    },
  };
}
