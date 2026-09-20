import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { DialogLayer } from "@rah-os/ui-web/neo-brutalist/dialog-layer";
import { browserOpaqueId } from "../browser-opaque-id.ts";
import { useState } from "react";

import type { RoomAgentTarget } from "@rah-os/ui-web";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

import { useDialogProtocol } from "../dialog-protocol.ts";

export type TaskCreateInput = {
  assigneeId?: string;
  collaboratorIds: readonly string[];
  dependencyTaskIds: readonly string[];
  reviewerIds: readonly string[];
  titles: readonly {
    clientId: string;
    title: string;
  }[];
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
  const entities = useWorkspaceEntities();
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
    <DialogLayer className="rah-dialog-layer" role="presentation">
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
                  {entities?.person(agent.participantId)?.displayName ||
                    agent.handle}
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
    </DialogLayer>
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
    <DialogLayer className="rah-dialog-layer" role="presentation">
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
    </DialogLayer>
  );
}

export function TaskCreateDialog({
  onClose,
  onCreate,
  onDiscard,
}: {
  onClose: () => void;
  onCreate: (
    input: TaskCreateInput,
    onAccepted: (clientId: string) => void,
  ) => Promise<void>;
  onDiscard: (clientIds: readonly string[]) => void;
}) {
  const [titles, setTitles] = useState(() => [newTaskTitle()]);
  const [pending, setPending] = useState(false);
  const [submissionLocked, setSubmissionLocked] = useState(false);
  const [acceptedClientIds, setAcceptedClientIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string>();
  const dismiss = () => {
    onDiscard(titles.map(({ clientId }) => clientId));
    onClose();
  };
  const dialogRef = useDialogProtocol({ blocked: pending, onClose: dismiss });
  const nonempty = titles
    .map((task) => ({ ...task, title: task.title.trim() }))
    .filter((task) => task.title !== "");
  const create = () => {
    if (pending) return;
    if (nonempty.length === 0) {
      setActionError("至少需要填写一个任务标题");
      return;
    }
    const accepted = new Set(acceptedClientIds);
    const remaining = nonempty.filter(
      ({ clientId }) => !accepted.has(clientId),
    );
    if (remaining.length === 0) return;
    setSubmissionLocked(true);
    setPending(true);
    void onCreate(
      {
        collaboratorIds: [],
        reviewerIds: [],
        dependencyTaskIds: [],
        titles: remaining,
      },
      (clientId) =>
        setAcceptedClientIds((current) =>
          current.includes(clientId) ? current : [...current, clientId],
        ),
    )
      .then(() => {
        setActionError(undefined);
        onClose();
      })
      .catch((caught) => setActionError(errorMessage(caught)))
      .finally(() => setPending(false));
  };
  const remainingCount = nonempty.filter(
    ({ clientId }) => !acceptedClientIds.includes(clientId),
  ).length;
  const createLabel = pending
    ? "创建中…"
    : submissionLocked
      ? `重试剩余 ${String(remainingCount)} 个任务`
      : titles.length > 1
        ? `创建 ${String(nonempty.length)} 个任务`
        : "创建任务";

  return (
    <DialogLayer
      className="rah-dialog-layer rah-task-create-layer"
      role="presentation"
    >
      <button
        aria-label="关闭新建任务窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={dismiss}
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
            <h2 id="rah-task-create-title">创建任务</h2>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending}
            onClick={dismiss}
          >
            <span className="rah-close-glyph" aria-hidden="true">
              ×
            </span>
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          {actionError === undefined ? null : (
            <p className="rah-dialog-error">{actionError}</p>
          )}
          {!submissionLocked ? null : (
            <p className="rah-dialog-status" role="status">
              已确认 {String(acceptedClientIds.length)} /{" "}
              {String(nonempty.length)}； 标题已冻结，只会重试尚未确认的任务。
            </p>
          )}
          <div className="rah-task-create-fields">
            {titles.map((task, index) => (
              <div className="rah-task-create-row" key={task.clientId}>
                <input
                  aria-label={`任务 ${String(index + 1)}`}
                  autoFocus={index === 0}
                  data-dialog-initial-focus={index === 0 ? true : undefined}
                  disabled={pending || submissionLocked}
                  onChange={(event) =>
                    setTitles((current) =>
                      current.map((item) =>
                        item.clientId === task.clientId
                          ? { ...item, title: event.target.value }
                          : item,
                      ),
                    )
                  }
                  placeholder={`任务 ${String(index + 1)}`}
                  type="text"
                  value={task.title}
                />
                {titles.length > 1 ? (
                  <button
                    aria-label={`移除任务 ${String(index + 1)}`}
                    className="btn rah-task-create-remove"
                    disabled={pending || submissionLocked}
                    onClick={() =>
                      setTitles((current) =>
                        current.filter(
                          (item) => item.clientId !== task.clientId,
                        ),
                      )
                    }
                    type="button"
                  >
                    <Icon name="x" />
                  </button>
                ) : null}
              </div>
            ))}
            <button
              className="btn rah-task-create-another"
              disabled={pending || submissionLocked}
              onClick={() =>
                setTitles((current) => [...current, newTaskTitle()])
              }
              type="button"
            >
              <Icon name="plus" />
              再加一条
            </button>
          </div>
          <footer>
            <button
              className="btn"
              disabled={pending}
              onClick={dismiss}
              type="button"
            >
              取消
            </button>
            <button
              className="btn btn-pink"
              disabled={
                pending || nonempty.length === 0 || remainingCount === 0
              }
            >
              {createLabel}
            </button>
          </footer>
        </form>
      </section>
    </DialogLayer>
  );
}

function newTaskTitle() {
  return {
    clientId: browserOpaqueId(),
    title: "",
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
