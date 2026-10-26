import { OfficialProfileInlineActions } from "./OfficialProfileActions.generated.tsx";
import {
  useInstanceBranches,
  type BranchSource,
} from "./useInstanceBranches.tsx";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { ClientAgentGetResponse } from "@rah-os/protocol";
import {
  PanelAction,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "raft-ui";
import { EllipsisVertical, Play, Square } from "lucide-react";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
import ConfirmDialog from "../packages/web/src/components/ConfirmDialog.tsx";
import { ManagementClient } from "./management-client.ts";
import { OperationStatus, useManagement } from "./ManagementUi.tsx";
/** AgentProfileOverflowMenu's command menu + ConfirmDialog, backed by Kernel state. */
export default function RuntimeControl({
  client,
  controlRoomId,
  workspaceId,
  agentId,
  name,
  items = [],
  branchSource,
  onBranched,
  active = true,
  disabled = false,
  responsive = false,
}: {
  client: RahClient;
  controlRoomId: string;
  workspaceId: string;
  agentId: string;
  name: string;
  branchSource?: BranchSource;
  onBranched?: () => void;
  items?: {
    label: string;
    run: () => void;
    disabled?: boolean;
    icon?: ReactNode;
    inline?: boolean;
  }[];
  active?: boolean;
  disabled?: boolean;
  responsive?: boolean;
}) {
  const branches = useInstanceBranches(
    client,
    workspaceId,
    agentId,
    branchSource,
    active,
    onBranched,
  );
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId, agentId],
  );
  const { state, error, setError } = useManagement(manager);
  const [agent, setAgent] = useState<ClientAgentGetResponse>();
  const [confirm, setConfirm] = useState<boolean>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setAgent(undefined);
    const read = async () => {
      try {
        const data = await client.request(
          "agent.get",
          { agentId },
          { signal: abort.signal },
        );
        if (!abort.signal.aborted) setAgent(data);
      } catch {
        if (!abort.signal.aborted) setAgent(undefined);
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(read, 3000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, agentId, tick, active]);
  const enabled = agent?.agent.definition.state === "enabled";
  const allowed = agent && agent.agent.definition.state !== "tombstoned";
  const label = enabled ? "停止实例" : "启用实例";
  const requestToggle = () => {
    setError("");
    setConfirm(!enabled);
  };
  const close = () => {
    if (manager.writes.state === "idle") setConfirm(undefined);
  };
  return (
    <>
      {responsive && (
        <OfficialProfileInlineActions>
          {items
            .filter((item) => item.inline)
            .map((item) => (
              <Tooltip
                key={item.label}
                content={item.label}
                contentProps={{ side: "bottom" }}
              >
                <PanelAction
                  aria-label={item.label}
                  onClick={item.run}
                  disabled={
                    disabled ||
                    state !== "idle" ||
                    branches.busy ||
                    item.disabled
                  }
                >
                  {item.icon}
                </PanelAction>
              </Tooltip>
            ))}
          <Tooltip content={label} contentProps={{ side: "bottom" }}>
            <PanelAction
              aria-label={label}
              onClick={requestToggle}
              disabled={
                disabled || state !== "idle" || branches.busy || !allowed
              }
            >
              {enabled ? <Square /> : <Play />}
            </PanelAction>
          </Tooltip>
        </OfficialProfileInlineActions>
      )}
      {/* Loom retains the overflow at every width for Fork/Side and channel actions. */}
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void branches.refreshSides();
        }}
      >
        <Tooltip content="更多操作" contentProps={{ side: "bottom" }}>
          <DropdownMenuTrigger
            render={
              <PanelAction
                aria-label={`更多操作 ${name}`}
                disabled={disabled || state !== "idle" || branches.busy}
              />
            }
          >
            <EllipsisVertical />
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent side="bottom" align="end" sideOffset={4}>
          <DropdownMenuItem disabled={!allowed} onClick={requestToggle}>
            {enabled ? <Square /> : <Play />}
            {label}
          </DropdownMenuItem>
          {[...items, ...branches.items].map((item) => (
            <DropdownMenuItem
              key={item.label}
              disabled={"disabled" in item ? !!item.disabled : false}
              onClick={item.run}
            >
              {"icon" in item ? item.icon : null}
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {branches.dialog}
      {confirm !== undefined && (
        <ConfirmDialog
          title={confirm ? "启用实例" : "停止实例"}
          confirmLabel={confirm ? "启用实例" : "停止实例"}
          confirmVariant={confirm ? "primary" : "warning"}
          closeOnConfirm={false}
          confirmDisabled={state !== "idle" || !allowed}
          onClose={close}
          message={
            <>
              <p>
                {confirm
                  ? `启用 ${name}，恢复处理待办消息并沿用原 session；不会重置上下文。`
                  : `停止 ${name}，阻止后续调度并请求终止当前执行。保留实例、session 和聊天记录；终止进度请查看动态。`}
              </p>
              <OperationStatus manager={manager} error={error} />
            </>
          }
          onConfirm={async () => {
            await manager.setEnabled(agentId, confirm, (outcome) => {
              if (outcome.kind === "ok") {
                setConfirm(undefined);
                setTick((v) => v + 1);
              } else if (outcome.kind === "rejected") {
                setError(
                  outcome.error instanceof Error
                    ? outcome.error.message
                    : String(outcome.error),
                );
                setTick((v) => v + 1);
              }
            });
          }}
        />
      )}
    </>
  );
}
