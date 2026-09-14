import { useState } from "react";
import { ActionMenu } from "@rah-os/ui-web/neo-brutalist/action-menu";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { HintTooltip } from "@rah-os/ui-web/neo-brutalist/tooltip";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

/** Raft _s: one set of callbacks, inline above 480px, overflow at/below 480px. */
export function AgentHeaderActions({
  name,
  enabled,
  canMessage,
  messagePending,
  onMessage,
  onStartStop,
  onRestart,
}: {
  name: string;
  enabled: boolean;
  canMessage: boolean;
  messagePending: boolean;
  onMessage: () => void;
  onStartStop?: (() => void) | undefined;
  onRestart?: (() => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const actions = [
    {
      key: "message",
      label: "聊天",
      aria: `给 ${name} 发消息`,
      icon: "chat" as const,
      disabled: !canMessage || messagePending,
      onSelect: onMessage,
    },
    {
      key: "state",
      label: enabled ? "停止 Agent" : "启动 Agent",
      aria: enabled ? "停止 Agent" : "启动 Agent",
      icon: enabled ? ("square" as const) : ("play" as const),
      disabled: !onStartStop,
      onSelect: onStartStop ?? (() => {}),
    },
    {
      key: "restart",
      label: "重启 / 重置",
      aria: "重启 / 重置",
      icon: "rotate-ccw" as const,
      disabled: !onRestart,
      onSelect: onRestart ?? (() => {}),
    },
  ];
  return (
    <>
      <div className="rah-agent-inline-actions">
        {actions.map((action) => (
          <HintTooltip key={action.key} content={action.label} side="bottom">
            <PanelHeaderAction
              aria-label={action.aria}
              disabled={action.disabled}
              pending={action.key === "message" && messagePending}
              className={
                action.key === "message"
                  ? "rah-agent-header-message"
                  : undefined
              }
              onClick={action.onSelect}
            >
              <Icon name={action.icon} />
            </PanelHeaderAction>
          </HintTooltip>
        ))}
      </div>
      <div className="rah-agent-overflow-actions">
        <ActionMenu
          open={open}
          onOpenChange={setOpen}
          label="Agent 操作"
          className="rah-context-actions rah-agent-header-menu"
          trigger={
            <PanelHeaderAction aria-label="更多操作">
              <Icon name="ellipsis-vertical" />
            </PanelHeaderAction>
          }
          items={actions.map((action) => ({
            ...action,
            label: (
              <>
                <Icon name={action.icon} />
                {action.label}
              </>
            ),
            onSelect: () => {
              setOpen(false);
              action.onSelect();
            },
          }))}
        />
      </div>
    </>
  );
}
