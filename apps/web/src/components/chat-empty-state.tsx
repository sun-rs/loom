import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

/** Structural port of Raft tg + ChatPanel empty branch, index-BoAC7nSE. */
export function ChatEmptyState() {
  return (
    <div className="rah-chat-empty" role="status">
      <div className="rah-chat-empty-icon">
        <Icon name="chat" />
      </div>
      <div className="rah-chat-empty-title">暂无消息</div>
    </div>
  );
}
