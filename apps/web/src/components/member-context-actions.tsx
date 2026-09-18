import { useState, type ReactElement } from "react";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import type { AgentExecutionResetMode } from "@rah-os/protocol";
import { ContextActions } from "@rah-os/ui-web/neo-brutalist/context-actions";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import {
  AgentStateDialog,
  type AgentStateChange,
} from "./agent-state-dialog.tsx";
import { AgentExecutionResetDialog } from "./agent-execution-reset-dialog.tsx";
import { useAgentStart } from "../use-agent-start.ts";
export type MemberContextControl = {
  canManage: boolean;
  fullResetEnabled: boolean;
  onMessage: (principalId: string) => Promise<void>;
  onChangeState?: AgentStateChange | undefined;
  onResetExecution?:
    | ((
        id: string,
        mode: AgentExecutionResetMode,
        key: string,
      ) => Promise<void>)
    | undefined;
};
export function MemberContextActions({
  agent,
  principalId,
  self = false,
  control,
  children,
}: {
  agent?: WorkspaceAgentView;
  principalId: string;
  self?: boolean;
  control: MemberContextControl;
  children: ReactElement;
}) {
  const [action, setAction] = useState<"state" | "reset">();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const startAgent = useAgentStart(
    agent?.agentDefinitionId,
    control.onChangeState,
  );
  const send = async () => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await control.onMessage(principalId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "无法打开会话");
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <ContextActions
        label="成员操作"
        trigger={children}
        items={[
          {
            key: "message",
            label: (
              <>
                <Icon name="chat" />
                发消息
              </>
            ),
            disabled: self || pending,
            onSelect: () => void send(),
          },
          ...(agent
            ? [
                {
                  key: "state",
                  separator: true,
                  label: (
                    <>
                      <Icon
                        name={agent.state === "disabled" ? "play" : "square"}
                      />
                      {agent.state === "disabled" ? "启动" : "停止"}
                    </>
                  ),
                  disabled:
                    !control.canManage ||
                    !control.onChangeState ||
                    startAgent.pending,
                  onSelect: () =>
                    agent.state === "disabled"
                      ? void startAgent.start()
                      : setAction("state"),
                },
                {
                  key: "reset",
                  label: (
                    <>
                      <Icon name="rotate-ccw" />
                      重启 / 重置
                    </>
                  ),
                  disabled: !control.canManage || !control.onResetExecution,
                  onSelect: () => setAction("reset"),
                },
              ]
            : []),
        ]}
      />
      {error && <p role="alert">{error}</p>}
      {startAgent.error && <p role="alert">{startAgent.error}</p>}
      {agent && action === "state" && control.onChangeState && (
        <AgentStateDialog
          agent={agent}
          state={agent.state === "disabled" ? "enabled" : "disabled"}
          onChange={control.onChangeState}
          onClose={() => setAction(undefined)}
        />
      )}
      {agent && action === "reset" && control.onResetExecution && (
        <AgentExecutionResetDialog
          agentName={agent.displayName}
          fullResetEnabled={control.fullResetEnabled}
          onConfirm={(mode, key) =>
            control.onResetExecution!(agent.agentDefinitionId, mode, key)
          }
          onClose={() => setAction(undefined)}
        />
      )}
    </>
  );
}
