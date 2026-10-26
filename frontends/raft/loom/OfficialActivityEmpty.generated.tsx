// GENERATED from locked db5e399 official source. Imports bind Loom; explicit compatibility patches only.
import {useIntl} from "react-intl";
import {MessageSquareText} from "lucide-react";
import EmptyState from "@loom/raft-web-source/EmptyState";
export default function ActivityEmpty({filter}:{filter?:string}) {const {formatMessage}=useIntl();return (<EmptyState
                className="flex h-full flex-col items-center justify-center"
                icon={<MessageSquareText size={36} />}
                title={filter === "pinned" ? "没有置顶的会话" : filter === "mentions"
                  ? formatMessage({ id: "thread.empty.mentionsTitle" })
                  : filter === "unread"
                    ? formatMessage({ id: "thread.empty.unreadTitle" })
                    : formatMessage({ id: "thread.empty.defaultTitle" })}
                description={filter === "pinned" ? "在侧栏置顶的频道和私信会显示在这里，连同它们的消息列。" : filter === "mentions"
                  ? formatMessage({ id: "thread.empty.mentionsDescription" })
                  : formatMessage({ id: "thread.empty.defaultDescription" })}
              />);}
