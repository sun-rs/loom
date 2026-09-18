import { browserOpaqueId } from "../browser-opaque-id.ts";
import { useRef, useState } from "react";

import type { AgentExecutionResetMode } from "@rah-os/protocol";

import { useDialogProtocol } from "../dialog-protocol.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

const OPTIONS = [
  {
    description: "停止并重新启动 agent 进程，保留运行时会话和工作区文件。",
    batchDescription: "停止并重启选中的 Agent。运行时会话和工作区文件会保留。",
    label: "重新启动",
    mode: "restart" as const,
    tone: "cyan",
  },
  {
    description:
      "清除运行时会话并重启。工作区文件（MEMORY.md、notes/）会保留。",
    batchDescription: "清除运行时会话并重启选中的 Agent。工作区文件会保留。",
    label: "重置会话并重启",
    mode: "session" as const,
    tone: "orange",
  },
  {
    description: "清除运行时会话，删除所有工作区文件，并从零开始重启。",
    batchDescription: "清除运行时会话、删除工作区文件，并重启选中的 Agent。",
    label: "完全重置并重启",
    mode: "full" as const,
    tone: "red",
  },
] as const;

export function AgentExecutionResetDialog({
  agentName,
  selectionCount,
  fullResetEnabled,
  onClose,
  onConfirm,
}: {
  agentName: string;
  selectionCount?: number;
  fullResetEnabled: boolean;
  onClose: () => void;
  onConfirm: (
    mode: AgentExecutionResetMode,
    idempotencyKey: string,
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<AgentExecutionResetMode>("restart");
  const [idempotencyKey] = useState(
    () => `web-agent-execution-reset-${browserOpaqueId()}`,
  );
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const pendingRef = useRef(false);
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });

  async function submit(): Promise<void> {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setSubmitted(true);
    setError(undefined);
    try {
      await onConfirm(mode, idempotencyKey);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重置 Agent 失败");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭 Agent 重启窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-agent-reset-title"
        aria-modal="true"
        className="rah-dialog rah-agent-reset-dialog"
        data-reset-scope={selectionCount === undefined ? "agent" : "batch"}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-agent-reset-title">
              重新启动{" "}
              {selectionCount === undefined
                ? agentName
                : `${selectionCount} 个 Agent`}
            </h2>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn rah-card-dialog-close"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <Icon name="x" />
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={pending || submitted}>
            <legend className="sr-only">重启方式</legend>
            {OPTIONS.map((option) => {
              const disabled = option.mode === "full" && !fullResetEnabled;
              const selected = mode === option.mode;
              return (
                <label
                  className={`rah-agent-reset-option is-${option.tone}${selected ? " is-selected" : ""}${disabled ? " is-disabled" : ""}`}
                  key={option.mode}
                >
                  <input
                    checked={selected}
                    disabled={disabled}
                    name="agent-reset-mode"
                    onChange={() => {
                      if (!disabled) setMode(option.mode);
                    }}
                    type="radio"
                    value={option.mode}
                  />
                  <span>
                    <b>{option.label}</b>
                    <small>
                      {selectionCount === undefined
                        ? option.description
                        : option.batchDescription}
                    </small>
                    {disabled ? (
                      <em>当前 daemon 尚未开放安全的完整重置。</em>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
          {mode === "full" ? (
            <p className="rah-agent-reset-warning" role="note">
              这会永久删除此 Agent 工作区中的全部文件，包括 MEMORY.md 和
              notes/，且无法撤销。本机项目目录不会被删除。
            </p>
          ) : null}
          {error ? (
            <p className="rah-dialog-error" role="alert">
              {error}
              <br />
              重试会确认本次操作结果。如需更换方式，请关闭后重新打开。
            </p>
          ) : null}
          <footer>
            <button
              className="btn"
              disabled={pending}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className={`btn rah-agent-reset-confirm is-${mode}`}
              disabled={pending}
              type="submit"
            >
              <Icon name="rotate-ccw" />
              {pending
                ? "重启中…"
                : mode === "full"
                  ? "完全重置并重启"
                  : mode === "session"
                    ? "重置会话并重启"
                    : "重新启动"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
