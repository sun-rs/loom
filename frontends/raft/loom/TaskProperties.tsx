import { createContext, useContext, useState, type ReactNode } from "react";
import {
  DescriptionList,
  DescriptionItem,
  DescriptionTerm,
  DescriptionDetails,
} from "raft-ui";
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
  update: (status: TaskWorkflowStatus) => void;
}>({ canManage: false, disabled: true, update: () => {} });
function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DescriptionItem className="flex min-w-0 items-center gap-2">
      <DescriptionTerm className="mb-0 shrink-0">{label}</DescriptionTerm>
      <DescriptionDetails className="min-w-0">{children}</DescriptionDetails>
    </DescriptionItem>
  );
}
/** Native TaskProperties composition; only the connected status property is editable. */
export default function TaskProperties({ task }: { task: Task }) {
  const { formatMessage } = useIntl(),
    actions = useContext(TaskActions);
  const [open, setOpen] = useState(false);
  return (
    <DescriptionList
      className="flex flex-wrap items-center gap-x-6 gap-y-2"
      data-testid="task-properties"
    >
      <Property label={formatMessage({ id: "task.properties.status" })}>
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
            setOpen(false);
            actions.update(id as TaskWorkflowStatus);
          }}
          open={open && !actions.disabled}
          onToggle={() => setOpen((v) => !v)}
          onRequestClose={() => setOpen(false)}
          badgeStatus={toRuiTaskStatus(task.status)}
          badgeClassName=""
          disabled={actions.disabled}
          buttonTestId="task-properties-status"
          optionTestIdPrefix="task-properties-status-option"
        />
      </Property>
      <Property label={formatMessage({ id: "task.properties.assignee" })}>
        {task.claimedByName
          ? `@${task.claimedByName}`
          : formatMessage({ id: "task.properties.unassigned" })}
      </Property>
      <Property label={formatMessage({ id: "task.properties.createdBy" })}>
        {task.createdByName}
      </Property>
    </DescriptionList>
  );
}
