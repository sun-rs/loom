import type { AgentDeletionDiagnostics } from "@rah-os/protocol";
import { agentDeletionNotice } from "../agent-deletion-notice.ts";

/**
 * R5 — display only. The Kernel owns why a deletion is blocked and what an
 * operator can do about it; this component renders that projection inside the
 * existing deletion dialog. It keeps no state of its own, offers no force
 * delete, and never claims the deletion timed out.
 */
export function AgentDeletionStatus({
  diagnostics,
}: {
  diagnostics: AgentDeletionDiagnostics | undefined;
}) {
  const notice = agentDeletionNotice(diagnostics);
  if (!notice) return null;
  return (
    <section
      aria-label="Agent 删除状态"
      className="rah-agent-deletion-status"
      data-status={diagnostics?.status}
    >
      <p className="rah-agent-deletion-status-title">{notice.title}</p>
      <dl className="rah-agent-deletion-status-detail">
        {notice.detail.map((line) => (
          <dd key={line}>{line}</dd>
        ))}
      </dl>
      {notice.steps.length > 0 && (
        <ol className="rah-agent-deletion-status-steps">
          {notice.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
