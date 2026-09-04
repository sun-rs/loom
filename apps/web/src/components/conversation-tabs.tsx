import { PanelTabs } from "@rah-os/ui-web/neo-brutalist/panel-tabs";

export function ConversationTabs({
  value,
  onSelect,
  canReadMessages = true,
  canReadTasks = true,
}: {
  value: "chat" | "tasks" | "files";
  onSelect: (value: "chat" | "tasks" | "files") => void;
  canReadMessages?: boolean;
  canReadTasks?: boolean;
}) {
  return (
    <PanelTabs
      label="对话内容"
      value={value}
      onSelect={onSelect}
      items={[
        { id: "chat", icon: "chat", label: "聊天", disabled: !canReadMessages },
        {
          id: "tasks",
          icon: "listcheck",
          label: "任务",
          disabled: !canReadTasks,
        },
        { id: "files", icon: "clip", label: "文件" },
      ]}
    />
  );
}
