import { useState } from "react";

import type { RoomAgentTarget } from "@rah-os/ui-web";

import { useDialogProtocol } from "../dialog-protocol.ts";

export type TaskCreateInput = {
  assigneeId?: string;
  collaboratorIds: string[];
  description?: string;
  reviewerIds: string[];
  title: string;
};

export function TaskReassignDialog({
  agents,
  currentAssigneeId,
  onClose,
  onConfirm,
  taskTitle,
}: {
  agents: readonly RoomAgentTarget[];
  currentAssigneeId: string;
  onClose: () => void;
  onConfirm: (assigneeId: string, reason: string) => Promise<void>;
  taskTitle: string;
}) {
  const candidates = agents.filter(
    ({ participantId }) => participantId !== currentAssigneeId,
  );
  const [assigneeId, setAssigneeId] = useState(
    candidates[0]?.participantId ?? "",
  );
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  const valid = assigneeId !== "" && reason.trim().length > 0;
  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭改派任务窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-task-reassign-title"
        aria-modal="true"
        className="rah-dialog rah-task-reassign-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-task-reassign-title">安全改派</h2>
            <p>{taskTitle}</p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending}
            onClick={onClose}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || pending) return;
            setPending(true);
            void onConfirm(assigneeId, reason.trim())
              .then(() => {
                setActionError(undefined);
                onClose();
              })
              .catch((caught) => setActionError(errorMessage(caught)))
              .finally(() => setPending(false));
          }}
        >
          <label>
            新负责人
            <select
              autoFocus
              data-dialog-initial-focus
              disabled={pending || candidates.length === 0}
              onChange={(event) => setAssigneeId(event.target.value)}
              value={assigneeId}
            >
              {candidates.length === 0 ? (
                <option value="">没有其他可用 Agent</option>
              ) : null}
              {candidates.map((agent) => (
                <option key={agent.participantId} value={agent.participantId}>
                  {agent.handle}
                </option>
              ))}
            </select>
          </label>
          <label>
            改派原因
            <textarea
              disabled={pending}
              onChange={(event) => setReason(event.target.value)}
              placeholder="说明为什么需要停止当前 Agent 并改派"
              rows={3}
              value={reason}
            />
          </label>
          <p className="rah-dialog-help">
            系统会先阻止旧 Agent 继续执行，等待本地 Runtime
            的终止证明，再把任务交给新负责人。
          </p>
          {actionError === undefined ? null : (
            <p className="rah-dialog-error">{actionError}</p>
          )}
          <footer>
            <button
              className="btn"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button className="btn btn-pink" disabled={pending || !valid}>
              {pending ? "等待原 Agent 停止…" : "确认改派"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function TaskCloseDialog({
  onClose,
  onConfirm,
  taskTitle,
}: {
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  taskTitle: string;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  const valid = reason.trim().length > 0;
  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭任务窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-task-close-title"
        aria-modal="true"
        className="rah-dialog rah-task-close-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-task-close-title">关闭任务</h2>
            <p>{taskTitle}</p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending}
            onClick={onClose}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || pending) return;
            setPending(true);
            void onConfirm(reason.trim())
              .then(() => {
                setActionError(undefined);
                onClose();
              })
              .catch((caught) => setActionError(errorMessage(caught)))
              .finally(() => setPending(false));
          }}
        >
          <label>
            关闭原因
            <textarea
              autoFocus
              data-dialog-initial-focus
              onChange={(event) => setReason(event.target.value)}
              placeholder="说明为什么停止此任务"
              rows={3}
              value={reason}
            />
          </label>
          <p className="rah-dialog-help">
            正在执行的 Agent 会先被终止并记录证明；之后才能重开为待办。
          </p>
          {actionError === undefined ? null : (
            <p className="rah-dialog-error">{actionError}</p>
          )}
          <footer>
            <button
              className="btn"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button className="btn btn-pink" disabled={pending || !valid}>
              {pending ? "正在关闭…" : "关闭任务"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function TaskCreateDialog({
  agents,
  onClose,
  onCreate,
  roomName,
}: {
  agents: readonly RoomAgentTarget[];
  onClose: () => void;
  onCreate: (input: TaskCreateInput) => Promise<void>;
  roomName: string | undefined;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [collaboratorIds, setCollaboratorIds] = useState<string[]>([]);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const valid = title.trim().length > 0;
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });

  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭新建任务窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-task-create-title"
        aria-modal="true"
        className="rah-dialog rah-task-create-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-task-create-title">新建任务</h2>
            <p>#{roomName ?? "room"}</p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending}
            onClick={onClose}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid || pending) return;
            setPending(true);
            void onCreate({
              ...(assigneeId === "" ? {} : { assigneeId }),
              collaboratorIds,
              ...(description.trim() === ""
                ? {}
                : { description: description.trim() }),
              title: title.trim(),
              reviewerIds,
            })
              .then(() => {
                setActionError(undefined);
                onClose();
              })
              .catch((caught) => setActionError(errorMessage(caught)))
              .finally(() => setPending(false));
          }}
        >
          <label>
            任务标题
            <input
              autoFocus
              data-dialog-initial-focus
              onChange={(event) => setTitle(event.target.value)}
              placeholder="描述需要完成的工作"
              value={title}
            />
          </label>
          <label>
            详细说明（可选）
            <textarea
              onChange={(event) => setDescription(event.target.value)}
              placeholder="补充目标、范围或验收标准"
              rows={4}
              value={description}
            />
          </label>
          <label>
            负责人
            <select
              onChange={(event) => {
                const next = event.target.value;
                setAssigneeId(next);
                if (next === "") {
                  setCollaboratorIds([]);
                  setReviewerIds([]);
                } else {
                  setCollaboratorIds((current) =>
                    current.filter((participantId) => participantId !== next),
                  );
                  setReviewerIds((current) =>
                    current.filter((participantId) => participantId !== next),
                  );
                }
              }}
              value={assigneeId}
            >
              <option value="">未指派（开放给 Room Agents）</option>
              {agents.map((agent) => (
                <option key={agent.participantId} value={agent.participantId}>
                  {agent.handle}
                </option>
              ))}
            </select>
          </label>
          <TaskRoleField
            agents={agents}
            disabled={assigneeId === ""}
            label="协作者（可选）"
            onChange={setCollaboratorIds}
            ownerId={assigneeId || undefined}
            selectedIds={collaboratorIds}
          />
          <TaskRoleField
            agents={agents}
            disabled={assigneeId === ""}
            label="审阅者（提交后唤醒，可选）"
            onChange={setReviewerIds}
            ownerId={assigneeId || undefined}
            selectedIds={reviewerIds}
          />
          {actionError === undefined ? null : (
            <p className="rah-dialog-error">{actionError}</p>
          )}
          <footer>
            <button
              className="btn"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button className="btn btn-pink" disabled={pending || !valid}>
              {pending ? "正在创建…" : "创建任务"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function TaskRoleField({
  agents,
  disabled,
  label,
  onChange,
  ownerId,
  selectedIds,
}: {
  agents: readonly RoomAgentTarget[];
  disabled: boolean;
  label: string;
  onChange: (participantIds: string[]) => void;
  ownerId: string | undefined;
  selectedIds: readonly string[];
}) {
  const selected = new Set(selectedIds);
  return (
    <fieldset className="rah-task-dialog-roles" disabled={disabled}>
      <legend>{label}</legend>
      <div>
        {agents
          .filter(({ participantId }) => participantId !== ownerId)
          .map((agent) => (
            <label key={agent.participantId}>
              <input
                checked={selected.has(agent.participantId)}
                onChange={() => {
                  const next = new Set(selected);
                  if (next.has(agent.participantId)) {
                    next.delete(agent.participantId);
                  } else {
                    next.add(agent.participantId);
                  }
                  onChange([...next].sort());
                }}
                type="checkbox"
              />
              {agent.handle}
            </label>
          ))}
      </div>
      {disabled ? <p>先选择负责人，再设置协作角色。</p> : null}
    </fieldset>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
