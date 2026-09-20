import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { EmptyState } from "@rah-os/ui-web/neo-brutalist/empty-state";

export function AgentUnavailablePanel({
  onClose,
}: {
  onClose?: (() => void) | undefined;
}) {
  return (
    <section className="rah-agent-detail-panel rah-agent-unavailable">
      <PanelHeader kind="agent">
        <span className="rah-agent-unavailable-icon">
          <Icon name="bot" />
        </span>
        <h2>Agent 不可用</h2>
        {onClose && (
          <button
            className="sq-btn"
            aria-label="关闭 Agent 详情"
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        )}
      </PanelHeader>
      <EmptyState
        context="profile"
        placement="fill"
        icon="triangle-alert"
        title="Agent 不可用"
        description="这个 Agent 已被终止，或已不在此 Server 中可用。"
      />
    </section>
  );
}
