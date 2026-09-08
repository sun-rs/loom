import { useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Task } from "@rah-os/protocol";
import type { RoomAgentTarget } from "@rah-os/ui-web";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import {
  createTaskAssigneeCommand,
  taskAssigneeMode,
  type TaskAssigneeIntent,
} from "../global-task-assignee.ts";
import { DiscoveryFilter } from "./discovery-filter.tsx";
import { TaskReassignDialog } from "./task-dialogs.tsx";

export function TaskAssigneeControl({
  client,
  task,
  agents,
  principalId,
  label,
  writeEnabled,
  onChanged,
}: {
  client: RahClient;
  task: Task;
  agents: readonly RoomAgentTarget[];
  principalId: string | undefined;
  label: string;
  writeEnabled: boolean;
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [reassignOpen, setReassignOpen] = useState(false);
  const command = useRef<
    | { key: string; execute: ReturnType<typeof createTaskAssigneeCommand> }
    | undefined
  >(undefined);
  const candidates = agents.filter(
    (agent) =>
      !task.collaboratorIds.includes(agent.participantId) &&
      !task.reviewerIds.includes(agent.participantId),
  );
  const mode = taskAssigneeMode(task, principalId);
  async function perform(intent: TaskAssigneeIntent) {
    const key = JSON.stringify(intent);
    if (command.current?.key !== key)
      command.current = {
        key,
        execute: createTaskAssigneeCommand({
          client,
          task,
          principalId,
          intent,
          idempotencyKey: `task-assignee-${crypto.randomUUID()}`,
        }),
      };
    setPending(true);
    setError(undefined);
    try {
      await command.current.execute();
      command.current = undefined;
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "负责人更新失败");
      throw failure;
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {mode === "idle" ? (
        <DiscoveryFilter
          label="任务负责人"
          triggerAriaLabel={`任务负责人：${label}`}
          triggerLabel={label}
          icon={null}
          multiple={false}
          searchable
          clearable={false}
          selected={false}
          disabled={
            pending ||
            !writeEnabled ||
            (candidates.length === 0 && !task.assigneeId)
          }
          values={[task.assigneeId ?? "unassigned"]}
          options={[
            { id: "unassigned", label: "未指派" },
            ...candidates.map((agent) => ({
              id: agent.participantId,
              label: agent.handle,
            })),
          ]}
          onChange={(values) => {
            const target = values[0];
            if (!target || target === (task.assigneeId ?? "unassigned")) return;
            void perform(
              target === "unassigned"
                ? { kind: "unassign" }
                : { kind: "assign", assigneeId: target },
            ).catch(() => {});
          }}
        />
      ) : mode === "reassign" ? (
        <button
          className="btn rah-task-assignee-reassign"
          aria-label={`改派任务负责人：${label}`}
          disabled={
            !writeEnabled ||
            pending ||
            candidates.every((agent) => agent.participantId === task.assigneeId)
          }
          onClick={() => setReassignOpen(true)}
        >
          {label}
          <Icon name="pencil" />
        </button>
      ) : (
        <span>{label}</span>
      )}
      {error && !reassignOpen ? (
        <span className="rah-inline-error" role="alert">
          {error}
        </span>
      ) : null}
      {reassignOpen && task.assigneeId ? (
        <TaskReassignDialog
          agents={candidates}
          currentAssigneeId={task.assigneeId}
          taskTitle={task.title}
          onClose={() => setReassignOpen(false)}
          onConfirm={(assigneeId, reason) =>
            perform({ kind: "reassign", assigneeId, reason })
          }
        />
      ) : null}
    </>
  );
}
