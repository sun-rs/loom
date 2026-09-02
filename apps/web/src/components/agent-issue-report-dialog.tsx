import { useRef, useState } from "react";

import type { RahClient } from "@rah-os/client-sdk";
import type { WorkspaceAgentView } from "@rah-os/ui-web";

import {
  buildAgentIssueReport,
  downloadAgentIssueReport,
  makeAgentIssueReportFilename,
} from "../agent-issue-report.ts";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { Icon } from "./icon.tsx";

export function AgentIssueReportDialog({
  agent,
  client,
  onClose,
}: {
  agent: WorkspaceAgentView;
  client: RahClient;
  onClose: () => void;
}) {
  const [description, setDescription] = useState("");
  const [includeActivity, setIncludeActivity] = useState(true);
  const [consented, setConsented] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [exportedFilename, setExportedFilename] = useState<string>();
  const pendingRef = useRef(false);
  const dialogRef = useDialogProtocol({ blocked: pending, onClose });

  async function submit(): Promise<void> {
    if (pendingRef.current || !consented) return;
    pendingRef.current = true;
    setPending(true);
    setError(undefined);
    try {
      const activities = includeActivity
        ? (
            await client.request("agent.trajectory.list", {
              agentDefinitionId: agent.agentDefinitionId,
              limit: 100,
            })
          ).activities
        : [];
      const generatedAt = new Date().toISOString();
      const report = buildAgentIssueReport({
        activities,
        agent: {
          agentDefinitionId: agent.agentDefinitionId,
          displayName: agent.displayName,
          handle: agent.handle,
          participantId: agent.participantId,
        },
        browser: {
          language: navigator.language,
          pathname: window.location.pathname,
          userAgent: navigator.userAgent,
          viewport: { height: window.innerHeight, width: window.innerWidth },
        },
        description,
        generatedAt,
        includeActivityDiagnostics: includeActivity,
      });
      const filename = makeAgentIssueReportFilename(
        agent.displayName,
        generatedAt,
      );
      downloadAgentIssueReport(report, filename);
      setExportedFilename(filename);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `无法导出诊断：${caught.message}`
          : "无法导出诊断",
      );
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="rah-dialog-layer" role="presentation">
      <button
        aria-label="关闭 Agent 问题诊断窗口"
        className="rah-dialog-backdrop"
        disabled={pending}
        onClick={onClose}
      />
      <section
        aria-labelledby="rah-agent-issue-report-title"
        aria-modal="true"
        className="rah-dialog rah-agent-issue-report-dialog"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div>
            <h2 id="rah-agent-issue-report-title">
              <Icon name="bug" /> 报告问题
            </h2>
            <p>生成本地诊断文件，不会自动上传</p>
          </div>
          <button
            aria-label="关闭"
            className="sq-btn"
            disabled={pending}
            onClick={onClose}
            type="button"
          >
            <span aria-hidden="true" className="rah-close-glyph">
              ×
            </span>
          </button>
        </header>
        {exportedFilename ? (
          <div className="rah-agent-issue-report-success">
            <span aria-hidden="true">
              <Icon name="check" />
            </span>
            <div>
              <h3>已导出到本机</h3>
              <p>{exportedFilename}</p>
              <small>请在分享前检查文件内容；RAH OS 没有上传此文件。</small>
            </div>
            <button className="btn is-lime" onClick={onClose} type="button">
              完成
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div className="rah-agent-issue-report-agent">
              <span>Agent</span>
              <b>{agent.displayName}</b>
              <small>@{agent.handle}</small>
            </div>
            <label>
              问题描述 <small>可选</small>
              <textarea
                data-dialog-initial-focus
                disabled={pending}
                onChange={(event) => setDescription(event.currentTarget.value)}
                placeholder="发生了什么？如何复现？"
                rows={3}
                value={description}
              />
            </label>
            <fieldset disabled={pending}>
              <legend>包含内容</legend>
              <p>默认只包含关联 ID、时间、状态和工具名称等安全诊断元数据。</p>
              <label className="rah-agent-issue-report-choice">
                <input
                  checked={includeActivity}
                  onChange={(event) =>
                    setIncludeActivity(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <b>最近活动诊断元数据</b>
                  <small>最多 100 条；不含工具输入、结果或推理文本。</small>
                </span>
              </label>
            </fieldset>
            <div className="rah-agent-issue-report-warning">
              <p>
                <b>敏感数据提示：</b>
                文件仍包含 Agent、Room 和运行记录的内部标识。请在分享前检查。
              </p>
              <label>
                <input
                  checked={consented}
                  disabled={pending}
                  onChange={(event) =>
                    setConsented(event.currentTarget.checked)
                  }
                  type="checkbox"
                />
                我理解此文件只保存到本机，并同意生成
              </label>
            </div>
            {error ? (
              <p className="rah-dialog-error" role="alert">
                {error}
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
                className="btn is-pink"
                disabled={pending || !consented}
                type="submit"
              >
                <Icon name="download" />
                {pending ? "正在生成…" : "导出到本机"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
