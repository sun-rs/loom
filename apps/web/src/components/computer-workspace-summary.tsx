import { computerWorkspaceState } from "../computer-workspace-state.ts";
import type { WorkspaceAgentView } from "@rah-os/ui-web";
import { ComputerWorkspaceDelete } from "./computer-workspace-delete.tsx";
import { formatRahDateTime } from "../date-time-presentation.ts";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { AgentWorkspaceSummary } from "@rah-os/protocol";
import { ProfileSection } from "@rah-os/ui-web/neo-brutalist/profile-section";

type Agent = {
  agentDefinitionId: string;
  handle: string;
  agent?: Pick<WorkspaceAgentView, "state" | "presence">;
};
type Row = Agent & { summary?: AgentWorkspaceSummary; error?: string };
export function ComputerWorkspaceSummary({
  client,
  agents,
  onOpen,
}: {
  client?: RahClient | undefined;
  agents: readonly Agent[];
  onOpen: (id: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>();
  const [pending, setPending] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  const scope = agents
    .map((a) => a.agentDefinitionId)
    .sort()
    .join("|");
  useEffect(() => {
    active.current?.abort();
    active.current = undefined;
    setRows(undefined);
    setPending(false);
    return () => {
      active.current?.abort();
      active.current = undefined;
    };
  }, [scope, client]);
  async function scan() {
    if (!client || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setRows(undefined);
    const result: Row[] = [];
    for (const agent of agents.slice(0, 50)) {
      if (controller.signal.aborted) return;
      try {
        const summary = await client.request(
          "agent.workspace.summary",
          { agentDefinitionId: agent.agentDefinitionId },
          { signal: controller.signal },
        );
        result.push({ ...agent, summary });
      } catch (error) {
        if (controller.signal.aborted) return;
        result.push({
          ...agent,
          error: error instanceof Error ? error.message : "扫描失败，请重试。",
        });
      }
      if (!controller.signal.aborted) setRows([...result]);
    }
    if (!controller.signal.aborted) {
      active.current = undefined;
      setPending(false);
    }
  }
  return (
    <ProfileSection
      title="AGENT 工作区"
      action={
        <button
          className="btn"
          type="button"
          aria-label={pending ? "扫描中…" : rows ? "重新扫描" : "扫描工作区"}
          disabled={!client || pending || agents.length === 0}
          onClick={() => void scan()}
        >
          <Icon name="refresh-cw" />
          {pending ? "扫描中…" : rows ? "重新扫描" : "扫描"}
        </button>
      }
    >
      {rows === undefined ? (
        <p className="rah-computer-hint rah-workspace-scan-hint">
          点击扫描，检查这台 Computer 上的工作区目录。
        </p>
      ) : (
        rows.map((row) => (
          <div
            className="rah-workspace-summary-row"
            key={row.agentDefinitionId}
            data-workspace-summary
          >
            <Icon name="folder-open" />
            <div className="rah-workspace-summary-body">
              <div className="rah-workspace-summary-heading">
                <button
                  className="rah-workspace-summary-name"
                  type="button"
                  onClick={() => onOpen(row.agentDefinitionId)}
                >
                  {row.handle}
                </button>
                {row.agent ? (
                  <span
                    className={`rah-workspace-state ${computerWorkspaceState(row.agent) === "ACTIVE" ? "is-active" : ""}`}
                  >
                    {computerWorkspaceState(row.agent)}
                  </span>
                ) : null}
              </div>
              {row.error ? (
                <p role="alert">{row.error}</p>
              ) : row.summary ? (
                <>
                  <code>{row.summary.rootPath}</code>
                  <p>
                    {row.summary.state === "absent"
                      ? "工作区尚未创建"
                      : `${row.summary.totalSizeBytes.toLocaleString()} bytes · ${row.summary.fileCount} 个文件`}
                    {row.summary.lastModified
                      ? ` · 修改于 ${formatRahDateTime(row.summary.lastModified, { month: "long", day: "numeric" })}`
                      : ""}
                    {row.summary.truncated
                      ? " · 部分结果（已达到扫描上限）"
                      : ""}
                  </p>
                </>
              ) : null}
            </div>
            {row.summary?.state !== "absent" && row.summary ? (
              <ComputerWorkspaceDelete
                client={client}
                id={row.agentDefinitionId}
                name={row.handle}
                onDeleted={() =>
                  setRows((current) =>
                    current?.filter(
                      (item) =>
                        item.agentDefinitionId !== row.agentDefinitionId,
                    ),
                  )
                }
              />
            ) : null}
          </div>
        ))
      )}
      {agents.length > 50 ? (
        <p role="status">
          本次只扫描前 50 个 Agent；可进入其他 Agent 的工作区查看。
        </p>
      ) : null}
      {agents.length === 0 ? <p>当前没有绑定的 Agent。</p> : null}
    </ProfileSection>
  );
}
