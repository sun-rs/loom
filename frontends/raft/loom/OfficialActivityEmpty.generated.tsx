// GENERATED from locked db5e399 official source. Imports bind Loom; explicit compatibility patches only.
import {useIntl} from "react-intl";
import {MessageSquareText} from "lucide-react";
import EmptyState from "@loom/raft-web-source/EmptyState";
export default function ActivityEmpty({filter}:{filter?:string}) {const {formatMessage}=useIntl();return (<EmptyState
                className="flex h-full flex-col items-center justify-center"
                icon={<MessageSquareText size={36} />}
                title={filter === "mentions"
                  ? formatMessage({ id: "thread.empty.mentionsTitle" })
                  : filter === "unread"
                    ? formatMessage({ id: "thread.empty.unreadTitle" })
                    : formatMessage({ id: "thread.empty.defaultTitle" })}
                description={filter === "mentions"
                  ? formatMessage({ id: "thread.empty.mentionsDescription" })
                  : formatMessage({ id: "thread.empty.defaultDescription" })}
              />);}
