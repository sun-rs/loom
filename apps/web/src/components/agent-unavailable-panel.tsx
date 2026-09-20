import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { PanelHeaderIcon } from "@rah-os/ui-web/neo-brutalist/panel-header-icon";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { EmptyState } from "@rah-os/ui-web/neo-brutalist/empty-state";

export function AgentUnavailablePanel({
  onClose,
  onBack = onClose,
  backLabel = "返回聊天",
}: {
  backLabel?: string | undefined;
  onBack?: (() => void) | undefined;
  onClose?: (() => void) | undefined;
}) {
  return (
    <section className="rah-agent-detail-panel rah-agent-unavailable">
      <PanelHeader kind="agent">
        {onBack && (
          <PanelHeaderAction
            className="rah-mobile-only rah-agent-mobile-back"
            aria-label={backLabel}
            onClick={onBack}
          >
            <Icon name="arrow-left" />
          </PanelHeaderAction>
        )}
        <PanelHeaderIcon name="bot" />
        <h2>Agent 不可用</h2>
        {onClose && (
          <PanelHeaderAction
            className="rah-desktop-only"
            aria-label="关闭 Agent 详情"
            onClick={onClose}
          >
            <Icon name="x" />
          </PanelHeaderAction>
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
