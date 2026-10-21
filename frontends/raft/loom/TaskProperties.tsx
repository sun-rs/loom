import { OfficialTaskProperties } from "./OfficialTaskSurfaces.generated";
import MentionAvatar from "./MentionAvatar.tsx";
import type { Principal } from "@rah-os/protocol";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import InlineBadgeEditor from "../packages/web/src/components/InlineBadgeEditor.tsx";
import {
  STATUS_STYLES,
  toRuiTaskStatus,
} from "../packages/web/src/components/task/taskStatusUi.ts";
import type { Task } from "../packages/web/src/store/taskStore.ts";
import {
  taskWorkflowTransitionOptions,
  type TaskWorkflowStatus,
} from "@rah-os/protocol";
export const TaskActions = createContext<{
  canManage: boolean;
  disabled: boolean;
  members?: readonly Principal[];
  canAssign?: boolean;
  assign?: (id: string | null) => void;
  history?: ReactNode;
  update: (status: TaskWorkflowStatus) => void;
}>({ canManage: false, disabled: true, update: () => {} });
/** Native TaskProperties composition; status and assignee use the connected native editors. */
export default function TaskProperties({ task }: { task: Task }) {
  const { formatMessage } = useIntl(),
    actions = useContext(TaskActions);
  const [open, setOpen] = useState<"status" | "assignee" | null>(null);
  const [search, setSearch] = useState("");
  return (
    <>
      <OfficialTaskProperties
        onKeyDownCapture={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.preventDefault();
          event.stopPropagation();
          const trigger = event.currentTarget.querySelector<HTMLButtonElement>(
            '[data-testid="task-properties-' + open + '"]',
          );
          setOpen(null);
          trigger?.focus();
        }}
        status={
          <InlineBadgeEditor
            displayValue={formatMessage({
              id: STATUS_STYLES[task.status].labelId,
            })}
            selectedId={task.status}
            options={taskWorkflowTransitionOptions(
              task.status,
              actions.canManage,
            ).map((id) => ({
              id,
              label: formatMessage({ id: STATUS_STYLES[id].labelId }),
            }))}
            onSelect={(id) => {
              setOpen(null);
              actions.update(id as TaskWorkflowStatus);
            }}
            open={open === "status" && !actions.disabled}
            onToggle={() => setOpen((v) => (v === "status" ? null : "status"))}
            onRequestClose={() => setOpen(null)}
            badgeStatus={toRuiTaskStatus(task.status)}
            badgeClassName=""
            disabled={actions.disabled}
            buttonTestId="task-properties-status"
            optionTestIdPrefix="task-properties-status-option"
          />
        }
        assignee={
          <InlineBadgeEditor
            displayValue={
              task.claimedByName
                ? `@${task.claimedByName}`
                : formatMessage({ id: "task.properties.unassigned" })
            }
            selectedId={task.claimedById ?? "unassigned"}
            options={[
              {
                id: "unassigned",
                label: formatMessage({ id: "task.properties.unassigned" }),
              },
              ...(actions.members ?? [])
                .filter((p) =>
                  (p.displayName ?? p.handle)
                    .toLowerCase()
                    .includes(search.trim().toLowerCase()),
                )
                .map((p) => ({
                  id: p.principalId,
                  label: p.displayName ?? p.handle,
                  avatar: (
                    <MentionAvatar
                      context="compact-list"
                      type={p.kind === "agent" ? "agent" : "human"}
                    />
                  ),
                })),
            ]}
            onSelect={(id) => {
              setOpen(null);
              if (id !== (task.claimedById ?? "unassigned"))
                actions.assign?.(id === "unassigned" ? null : id);
            }}
            open={
              open === "assignee" &&
              !actions.disabled &&
              !!actions.canAssign &&
              task.status !== "done"
            }
            onToggle={() => {
              setSearch("");
              setOpen((v) => (v === "assignee" ? null : "assignee"));
            }}
            onRequestClose={() => setOpen(null)}
            badgeClassName="bg-transparent text-foreground"
            disabled={
              actions.disabled || !actions.canAssign || task.status === "done"
            }
            buttonTitle={
              task.status === "done"
                ? formatMessage({ id: "task.permissions.done" })
                : undefined
            }
            buttonTestId="task-properties-assignee"
            dropdownTestId="task-assignee-dropdown"
            searchable
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder={formatMessage({
              id: "task.assignee.searchPlaceholder",
            })}
            popoverTitle={formatMessage({ id: "task.properties.assignee" })}
          />
        }
        createdBy={<span>{task.createdByName}</span>}
      />
      {actions.history}
    </>
  );
}
