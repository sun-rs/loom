import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { browserOpaqueId } from "../browser-opaque-id.ts";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { createLatestRequest } from "../latest-request.ts";

export type AgentStateChange = (
  id: string,
  state: "enabled" | "disabled" | "tombstoned",
  key: string,
) => Promise<void>;

/** Direct profile actions use the existing canonical state intent and its fences. */
export function AgentStateDialog({
  agent,
  state,
  onChange,
  onClose,
}: {
  agent: WorkspaceAgentView;
  state: "enabled" | "disabled" | "tombstoned";
  onChange: AgentStateChange;
  onClose: () => void;
}) {
  const [key] = useState(() => `web-agent-state-${browserOpaqueId()}`);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const actions = useRef(createLatestRequest());
  useEffect(() => {
    const requests = actions.current;
    return () => requests.cancel();
  }, []);
  const title =
    state === "disabled"
      ? "停止 Agent"
      : state === "enabled"
        ? "启动 Agent"
        : "删除 Agent";
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });
  async function submit() {
    if (inFlight.current) return;
    const request = actions.current.begin();
    inFlight.current = true;
    setPending(true);
    setError(undefined);
    try {
      await onChange(agent.agentDefinitionId, state, key);
      if (request.current()) onClose();
    } catch (error) {
      if (request.current())
        setError(error instanceof Error ? error.message : "操作失败，请重试。");
    } finally {
      if (request.owns()) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }
  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭 Agent 操作窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-agent-state-title"
        aria-modal="true"
        aria-busy={pending}
        className={`rah-dialog${state !== "enabled" ? " rah-channel-confirmation rah-agent-state-confirmation" : ""}`}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <h2 id="rah-agent-state-title">{title}</h2>
          <button
            className="sq-btn"
            aria-label="关闭"
            disabled={pending}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </header>
        {state !== "enabled" ? (
          <>
            <p>
              {state === "disabled"
                ? `确定要停止“${agent.displayName}”吗？该 Agent 将停止处理消息。`
                : `确定要删除“${agent.displayName}”吗？这会移除 Agent 身份及关联权限，且无法撤销。`}
            </p>
            {error && (
              <div className="rah-confirmation-error" role="alert">
                {error}
              </div>
            )}
          </>
        ) : (
          <div className="rah-dialog-body">
            <p>{`启动 ${agent.displayName}，恢复接收工作。`}</p>
            {error && (
              <p className="rah-dialog-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}
        <footer>
          <button className="btn" disabled={pending} onClick={onClose}>
            取消
          </button>
          <button
            className={`btn ${state === "tombstoned" ? "btn-red" : state === "disabled" ? "btn-orange" : "btn-green"}`}
            disabled={pending}
            onClick={() => void submit()}
          >
            {pending && state !== "enabled" && (
              <span
                className="rah-confirmation-spinner"
                role="status"
                aria-label="处理中"
              />
            )}
            {pending
              ? state === "disabled"
                ? "停止中…"
                : state === "tombstoned"
                  ? "删除中…"
                  : "处理中…"
              : title}
          </button>
        </footer>
      </section>
    </div>
  );
}
