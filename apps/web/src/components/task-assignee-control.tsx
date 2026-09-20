import { HintTooltip } from "@rah-os/ui-web/neo-brutalist/tooltip";
import { raftTaskGroup } from "../global-discovery-model.ts";
import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { ProfileImageAvatar } from "./profile-image-avatar.tsx";
import { browserOpaqueId } from "../browser-opaque-id.ts";
import { useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Task, Principal } from "@rah-os/protocol";
import {
  createTaskAssigneeCommand,
  taskAssigneeMode,
  type TaskAssigneeIntent,
} from "../global-task-assignee.ts";
import { DiscoveryFilter } from "./discovery-filter.tsx";

export function TaskAssigneeControl({
  client,
  task,
  people,
  principalId,
  label,
  writeEnabled,
  onChanged,
}: {
  client: RahClient;
  task: Task;
  people: readonly Principal[];
  principalId: string | undefined;
  label: string;
  writeEnabled: boolean;
  onChanged: (task?: Task) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const command = useRef<
    | { key: string; execute: ReturnType<typeof createTaskAssigneeCommand> }
    | undefined
  >(undefined);
  const entities = useWorkspaceEntities();
  const candidates = people
    .map((person) => entities?.resolvePerson(person) ?? person)
    .sort(
      (a, b) =>
        Number(b.kind === "human") - Number(a.kind === "human") ||
        (a.displayName || a.handle).localeCompare(b.displayName || b.handle),
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
          idempotencyKey: `task-assignee-${browserOpaqueId()}`,
        }),
      };
    setPending(true);
    setError(undefined);
    try {
      const result = await command.current.execute();
      command.current = undefined;
      onChanged(result.task);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "负责人更新失败");
      throw failure;
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <HintTooltip
        content="已完成的任务不能更换负责人，请先重新打开任务。"
        disabled={raftTaskGroup(task) !== "done"}
        side="bottom"
      >
        <span tabIndex={raftTaskGroup(task) === "done" ? 0 : undefined}>
          <DiscoveryFilter
            label="任务负责人"
            triggerAriaLabel={`任务负责人：${label}`}
            triggerLabel={label}
            icon={null}
            variant="status"
            className="rah-task-status-picker"
            popoverClassName="is-task-assignee"
            popoverTitle="负责人"
            searchPlaceholder="搜索人和 Agent"
            multiple={false}
            searchable
            clearable={false}
            selected={false}
            disabled={
              mode !== "idle" ||
              pending ||
              !writeEnabled ||
              candidates.length === 0
            }
            values={[task.assigneeId ?? "unassigned"]}
            options={[
              { id: "unassigned", label: "未指派", reserveLeadingSlot: true },
              ...candidates.map((agent) => ({
                id: agent.principalId,
                label: agent.displayName || agent.handle,
                reserveLeadingSlot: true,
                leading: (
                  <span aria-hidden="true">
                    <ProfileImageAvatar
                      avatarKey={agent.avatarKey}
                      name={agent.displayName || agent.handle}
                      kind={agent.kind}
                      principalId={agent.principalId}
                      size="compact"
                    />
                  </span>
                ),
              })),
            ]}
            onChange={(values) => {
              const target = values[0];
              if (!target || target === (task.assigneeId ?? "unassigned"))
                return;
              void perform(
                target === "unassigned"
                  ? { kind: "unassign" }
                  : { kind: "assign", assigneeId: target },
              ).catch(() => {});
            }}
          />
        </span>
      </HintTooltip>
      {error ? (
        <span className="rah-inline-error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}
