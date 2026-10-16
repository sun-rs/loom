import { useIntl } from "react-intl";
import { MessageSquareText } from "lucide-react";
import EmptyState from "../packages/web/src/components/ui/EmptyState.tsx";
/** ThreadsInbox's supported All/Unread/Mentions empty-state composition. */
export default function ActivityEmpty({ filter }: { filter?: string }) {
  const { formatMessage } = useIntl();
  return (
    <EmptyState
      className="flex h-full flex-col items-center justify-center"
      icon={<MessageSquareText size={36} />}
      title={formatMessage({
        id:
          filter === "mentions"
            ? "thread.empty.mentionsTitle"
            : filter === "unread"
              ? "thread.empty.unreadTitle"
              : "thread.empty.defaultTitle",
      })}
      description={formatMessage({
        id:
          filter === "mentions"
            ? "thread.empty.mentionsDescription"
            : "thread.empty.defaultDescription",
      })}
    />
  );
}
