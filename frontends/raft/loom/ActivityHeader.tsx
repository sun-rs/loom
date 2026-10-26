import {
  OfficialActivityHeader,
  OfficialActivityMarkAll,
} from "./OfficialActivityHeader.generated";
import DiscoveryNotice from "./DiscoveryNotice";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "raft-ui";
import { RefreshCw } from "lucide-react";
import type { RahClient } from "@rah-os/client-sdk";
import { captureUnreadActivity } from "./activity-bulk.ts";
/** Native ThreadsInbox header; counts and read frontiers come from Loom. */
export default function ActivityHeader({
  client,
  workspaceId,
  revision,
  onRefresh,
  onNextUnread,
  renderToolbar,
}: {
  client: RahClient;
  workspaceId: string;
  revision: number;
  onRefresh: () => void;
  onNextUnread: () => void;
  renderToolbar: (actions: ReactNode) => ReactNode;
}) {
  const [counts, setCounts] = useState<{ total: number; unread?: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const read = () =>
      client
        .request(
          "activity.list",
          { workspaceId, filter: "all", limit: 1 },
          { signal: abort.signal },
        )
        .then((r) => {
          if (!abort.signal.aborted)
            setCounts({
              total: r.total,
              unread: r.summary?.unreadActivityCount,
            });
        })
        .catch(() => {
          if (!abort.signal.aborted) setCounts(undefined);
        });
    void read();
    const timer = setInterval(() => void read(), 15000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [client, workspaceId, revision]);
  const markAll = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const requests = await captureUnreadActivity((cursor) =>
        client.request("activity.list", {
          workspaceId,
          filter: "unread",
          limit: 100,
          ...(cursor ? { cursor } : {}),
        }),
      );
      // No retry after an unknown write; refresh durable state instead.
      for (const request of requests) {
        if (!mounted.current) break;
        await client.request("activity.mark", request);
      }
    } catch {
      if (mounted.current)
        setError("未确认全部已读结果，已停止后续操作；请刷新核对。");
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        onRefresh();
      }
    }
  };
  return (
    <>
      <OfficialActivityHeader
        totalCount={counts?.total}
        totalUnreadCount={counts?.unread}
        unknownSubtitle="— 条进行中 · — 条未读"
        headerContainerProps={{
          "data-testid": "inbox-header",
          title: "双击跳转到下一条未读项",
        }}
        headerTitleClickProps={{
          "data-testid": "inbox-header-title",
          title: "双击跳转到下一条未读项",
          onClick: (event) => {
            if (event.detail >= 2) onNextUnread();
          },
        }}
        onMobileBack={undefined}
        mobileBackProps={{ "aria-label": "返回聊天列表" }}
        actions={
          <>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="刷新动态"
              disabled={busy}
              onClick={onRefresh}
            >
              <RefreshCw size={16} />
            </Button>
          </>
        }
      />
      {renderToolbar(
        (counts?.unread ?? 0) > 0 ? (
          <OfficialActivityMarkAll
            busy={busy}
            handleMarkAllRead={() => void markAll()}
          />
        ) : null,
      )}
      {error && <DiscoveryNotice>{error}</DiscoveryNotice>}
    </>
  );
}
