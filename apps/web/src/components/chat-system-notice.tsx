import type { NavigationTarget } from "@rah-os/protocol";
import type { GroupedChatTimelineItem } from "../chat-timeline-presentation.ts";
import { ChatMessageTime } from "./chat-message-time.tsx";
import { NavigationReceiptLink } from "./navigation-receipt-link.tsx";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";

export function ChatSystemNotice({
  item,
  expanded,
  onToggle,
  onOpenTarget,
}: {
  item: Exclude<GroupedChatTimelineItem, { kind: "message" }>;
  expanded: boolean;
  onToggle: () => void;
  onOpenTarget?: (request: NavigationTarget) => void;
}) {
  if (item.kind === "system-group")
    return (
      <div className="rah-system-message-group">
        <div className="rah-system-message-summary">
          <button type="button" aria-expanded={expanded} onClick={onToggle}>
            <span>有 {item.items.length} 条系统消息</span>
            <Icon name="chevron" />
          </button>
        </div>
        {expanded
          ? item.items.map((notice) => (
              <ChatSystemNotice
                key={notice.eventId}
                item={notice}
                expanded={false}
                onToggle={onToggle}
                {...(onOpenTarget ? { onOpenTarget } : {})}
              />
            ))
          : null}
      </div>
    );
  return (
    <p className="rah-chat-system-notice" data-read-event-id={item.eventId}>
      <ChatMessageTime value={item.createdAt} />{" "}
      {item.kind === "reminder-fired" ? (
        <NavigationReceiptLink
          {...(onOpenTarget ? { onOpenTarget } : {})}
          target={item.target}
          text={item.text}
        />
      ) : (
        item.text
      )}
    </p>
  );
}
