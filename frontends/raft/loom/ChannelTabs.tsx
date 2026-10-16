import { useState } from "react";
import { useIntl } from "react-intl";
import { MessageSquare, ListTodo } from "lucide-react";
import {
  ConversationPanelTabs,
  Tabs,
  SortableTabsList,
  SortableTabsTab,
  TabsLabel,
  TabsIndicator,
} from "raft-ui";
/** ChatPanel's tab composition; unsupported Files omitted. Order is local to this mounted channel. */
export default function ChannelTabs({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { formatMessage } = useIntl();
  const [order, setOrder] = useState(["chat", "tasks"]);
  return (
    <ConversationPanelTabs
      render={<Tabs value={value} onValueChange={onChange} />}
    >
      <SortableTabsList value={order} onReorder={setOrder} variant="underline">
        {order.map((id) => {
          const Icon = id === "chat" ? MessageSquare : ListTodo;
          return (
            <SortableTabsTab
              key={id}
              value={id}
              data-testid={`panel-tab-${id}`}
              className="!cursor-default h-7"
            >
              <Icon size={12} />
              <TabsLabel>
                {formatMessage({
                  id:
                    id === "chat"
                      ? "message.chatPanel.tabChat"
                      : "message.chatPanel.tabTasks",
                })}
              </TabsLabel>
            </SortableTabsTab>
          );
        })}
        <TabsIndicator />
      </SortableTabsList>
    </ConversationPanelTabs>
  );
}
