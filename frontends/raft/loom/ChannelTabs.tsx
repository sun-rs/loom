import { uiActionProps } from "./ui-action-props.ts";
import { useEffect, useMemo, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { SidebarPreferences } from "@rah-os/protocol";
import { ManagementClient } from "./management-client.ts";
import { OperationStatus, useManagement } from "./ManagementUi.tsx";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
import { useIntl } from "react-intl";
import { MessageSquare, ListTodo, Folder } from "lucide-react";
import {
  Button,
  useOrderedTabs,
  ConversationPanelTabs,
  Tabs,
  SortableTabsList,
  SortableTabsTab,
  TabsLabel,
  TabsIndicator,
} from "raft-ui";
const tabs = [{ id: "chat" }, { id: "tasks" }, { id: "workspace" }] as const;
/** Official ChatPanel/useOrderedTabs composition, with Loom's revisioned personal preference facade. */
export default function ChannelTabs({
  value,
  onChange,
  onDefaultTab,
  client,
  workspaceId,
  controlRoomId,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
  value: string;
  onChange: (value: string) => void;
  onDefaultTab: (value: string) => void;
}) {
  const { formatMessage } = useIntl();
  const manager = useMemo(
    () => new ManagementClient(client, workspaceId, controlRoomId),
    [client, workspaceId, controlRoomId],
  );
  useRouteIntentOwner(manager.writes);
  const { state, error, setError } = useManagement(manager);
  const [preferences, setPreferences] = useState<SidebarPreferences>();
  const [readError, setReadError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    void client
      .request("sidebar.get", { workspaceId }, { signal: abort.signal })
      .then((result) => {
        if (!abort.signal.aborted) {
          setPreferences(result.preferences);
          setReadError("");
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setReadError("无法读取标签顺序，请重试。");
      });
    return () => abort.abort();
  }, [client, workspaceId, version]);
  const order = useOrderedTabs(
    tabs,
    preferences?.channelPanelTabOrder ?? [],
  ).map((tab) => tab.id);
  const defaultTab = order[0] ?? "chat";
  useEffect(() => {
    if (preferences) onDefaultTab(defaultTab);
  }, [preferences, defaultTab, onDefaultTab]);
  const reorder = (nextOrder: ("chat" | "tasks" | "workspace")[]) => {
    if (!preferences || state !== "idle" || readError) return;
    setError("");
    void manager.sidebar(
      { channelPanelTabOrder: nextOrder },
      preferences.version,
      (outcome) => {
        if (outcome.kind === "ok") {
          setError("");
          setVersion((v) => v + 1);
        } else if (outcome.kind === "rejected") {
          setError("标签顺序保存失败；重新读取后可再次拖动。");
          setVersion((v) => v + 1);
        }
      },
    );
  };
  return (
    <>
      <ConversationPanelTabs
        render={<Tabs value={value} onValueChange={onChange} />}
      >
        <SortableTabsList value={order} onReorder={reorder} variant="underline">
          {order.map((id) => {
            const Icon =
              id === "chat"
                ? MessageSquare
                : id === "tasks"
                  ? ListTodo
                  : Folder;
            return (
              <SortableTabsTab
                disabled={!preferences || state !== "idle"}
                key={id}
                value={id}
                data-testid={`panel-tab-${id}`}
                className="!cursor-default h-7"
              >
                <Icon size={12} />
                <TabsLabel>
                  {id === "workspace"
                    ? "工作区"
                    : formatMessage({
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
      <OperationStatus manager={manager} error={error || readError} />
      {readError && (
        <Button
          {...uiActionProps.recovery}
          onClick={() => setVersion((v) => v + 1)}
        >
          重试读取标签顺序
        </Button>
      )}
    </>
  );
}
