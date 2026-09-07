import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useEffect, useRef, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { AgentWorkspaceSummary } from "@rah-os/protocol";
import { ProfileSection } from "@rah-os/ui-web/neo-brutalist/profile-section";

type Agent = { agentDefinitionId: string; handle: string };
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
      title="工作区扫描"
      action={
        <button
          className="btn"
          type="button"
          aria-label={pending ? "扫描中…" : rows ? "重新扫描" : "扫描工作区"}
          disabled={!client || pending || agents.length === 0}
          onClick={() => void scan()}
        >
          {pending ? "扫描中…" : rows ? "重新扫描" : "扫描"}
        </button>
      }
    >
      {rows === undefined ? (
        <p className="rah-computer-hint">
          扫描这台 Computer 上各 Agent 工作区的可浏览文件，不包含独立运行项目。
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
              <button
                className="rah-workspace-summary-name"
                type="button"
                onClick={() => onOpen(row.agentDefinitionId)}
              >
                {row.handle}
              </button>
              {row.error ? (
                <p role="alert">{row.error}</p>
              ) : row.summary ? (
                <>
                  <p>
                    {row.summary.state === "absent"
                      ? "工作区尚未创建"
                      : `${row.summary.fileCount} 个文件 · ${row.summary.totalSizeBytes.toLocaleString()} bytes`}
                    {row.summary.truncated
                      ? " · 部分结果（已达到扫描上限）"
                      : ""}
                  </p>
                  <code>{row.summary.rootPath}</code>
                </>
              ) : null}
            </div>
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
