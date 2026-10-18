import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { SystemNotification } from "@rah-os/protocol";
import { AlertTriangle, WifiOff } from "lucide-react";
import { useIntl } from "react-intl";
import NotificationTrigger from "../packages/web/src/components/layout/NotificationTrigger.tsx";
import type { NotificationEntry } from "../packages/web/src/components/layout/useSystemNotifications.tsx";
import { dismissSystemNotification } from "./system-notifications.ts";
const Context = createContext<NotificationEntry[] | null>(null);
export function SystemNotificationsProvider({
  client,
  workspaceId,
  children,
}: {
  client: RahClient;
  workspaceId?: string;
  children: ReactNode;
}) {
  const { formatMessage } = useIntl();
  const [rows, setRows] = useState<SystemNotification[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(new Set<string>());
  const pendingRef = useRef(new Set<string>());
  const generation = useRef(0);
  const current = useRef(workspaceId);
  current.current = workspaceId;
  const read = async () => {
    if (!workspaceId) return;
    const requestGeneration = ++generation.current;
    try {
      const result = await client.request("notification.list", { workspaceId });
      if (
        current.current === workspaceId &&
        generation.current === requestGeneration
      ) {
        setRows(result.notifications);
        setError("");
      }
    } catch {
      if (
        current.current === workspaceId &&
        generation.current === requestGeneration
      ) {
        setRows([]);
        setError("系统通知暂时无法读取。");
      }
    }
  };
  useEffect(() => {
    current.current = workspaceId;
    setRows([]);
    setError("");
    setPending(new Set());
    pendingRef.current.clear();
    void read();
    const timer = setInterval(() => {
      if (!document.hidden) void read();
    }, 15000);
    return () => {
      clearInterval(timer);
      current.current = undefined;
    };
  }, [client, workspaceId]);
  const dismiss = async (id: string) => {
    if (!workspaceId || pendingRef.current.has(id)) return;
    pendingRef.current.add(id);
    setPending(new Set(pendingRef.current));
    let unknown = false;
    try {
      await dismissSystemNotification(
        client,
        workspaceId,
        id,
        crypto.randomUUID(),
      );
    } catch {
      unknown = true;
    } finally {
      await read();
      if (current.current === workspaceId) {
        pendingRef.current.delete(id);
        setPending(new Set(pendingRef.current));
        if (unknown) setError("关闭结果未确认，已重新读取；不会自动重发。");
      }
    }
  };
  const entries: NotificationEntry[] = rows.map((row) => ({
    id: row.notificationId,
    kind: "warning",
    icon: <WifiOff size={16} className="text-foreground-strong " />,
    title: formatMessage(
      { id: "layout.systemNotifications.machineOfflineTitle" },
      { names: row.computerName, count: 1 },
    ),
    body: null,
    ...(row.dismissible
      ? {
          secondaryAction: {
            label: formatMessage({ id: "common.announcement.dismiss" }),
            disabled: pending.has(row.notificationId),
            onClick: () => void dismiss(row.notificationId),
          },
        }
      : {}),
  }));
  if (error)
    entries.unshift({
      id: "loom-notification-read-error",
      kind: "warning",
      icon: <AlertTriangle size={16} />,
      title: error,
      body: null,
      unread: false,
      action: { label: "重新读取", onClick: () => void read() },
    });
  return <Context.Provider value={entries}>{children}</Context.Provider>;
}
export default function SystemNotifications({
  flavor,
}: {
  flavor: "rail-bottom" | "mobile-navbar";
}) {
  const entries = useContext(Context);
  return entries ? (
    <NotificationTrigger flavor={flavor} notifications={entries} />
  ) : null;
}
