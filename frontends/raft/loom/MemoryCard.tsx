// Structural port: ThreadsInbox InboxRow geometry/states (adoption.json).
// Local glue: memory content, six-line preview, lazy read and management menus.
import { useEffect, useRef, useState } from "react";
import { Card, Button, Badge } from "raft-ui";
import { Pin } from "lucide-react";
import type { MemoryEntry } from "@rah-os/protocol";
import type { RahClient } from "@rah-os/client-sdk";
import { SidebarContextMenu } from "./SidebarMenus.tsx";
import { ActionMenu } from "./ManagementUi.tsx";

export type MemoryAction = {
  label: string;
  run: () => void;
  disabled?: boolean;
};
export default function MemoryCard({
  entry,
  client,
  channelName,
  active,
  busy,
  onOpen,
  actions,
}: {
  entry: MemoryEntry;
  client: RahClient;
  channelName?: string;
  active: boolean;
  busy: boolean;
  onOpen: () => void;
  actions: MemoryAction[];
}) {
  const root = useRef<HTMLDivElement>(null),
    preview = useRef<HTMLParagraphElement>(null);
  const [visible, setVisible] = useState(false),
    [body, setBody] = useState<string>();
  const [error, setError] = useState(false),
    [retry, setRetry] = useState(0);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    setBody(undefined);
    setError(false);
    if (entry.state === "deleted") {
      setBody("正文已删除");
      return;
    }
    void client
      .request(
        "memory.read",
        { entryId: entry.entryId },
        { signal: abort.signal },
      )
      .then((r) => {
        if (!abort.signal.aborted) setBody(r.entry.body ?? "正文已删除");
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [client, entry.entryId, entry.revision, entry.state, visible, retry]);
  useEffect(() => {
    const node = preview.current;
    if (!node) return;
    const measure = () => setClipped(node.scrollHeight > node.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [body]);
  return (
    <div ref={root}>
      <SidebarContextMenu
        label="记忆卡片操作"
        disabled={busy}
        items={[{ label: "打开", run: onOpen }, ...actions]}
      >
        <Card
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-label={entry.name}
          aria-disabled={busy}
          data-testid="memory-card"
          data-active={active || undefined}
          aria-current={active || undefined}
          onClick={() => {
            if (!busy) onOpen();
          }}
          onKeyDown={(event) => {
            if (
              event.target === event.currentTarget &&
              (event.key === "Enter" || event.key === " ")
            ) {
              event.preventDefault();
              if (!busy) onOpen();
            }
          }}
          className={`group relative flex w-full items-start gap-3 rounded-md border p-3 theme-brutal:rounded-none text-left transition-colors hover:border-line-muted hover:bg-fill-muted hover:shadow-raft-sm active:border-line-muted active:shadow-raft-sm theme-brutal:border-2 theme-brutal:hover:border-black theme-brutal:hover:shadow-brutal-sm theme-brutal:active:border-black theme-brutal:active:shadow-brutal-sm ${active ? "border-line-muted bg-fill-muted shadow-raft-sm theme-brutal:border-black theme-brutal:bg-white theme-brutal:shadow-brutal-sm" : "border-line-muted bg-layer-card theme-brutal:border-black/30 theme-brutal:bg-white"}`}
        >
          <div className="min-w-0 w-full">
            <div className="mb-0.5 flex min-w-0 items-start gap-2">
              <div className="line-clamp-2 min-w-0 flex-1 text-sm leading-5 font-semibold text-foreground-strong">
                {entry.pinned && (
                  <Pin size={12} className="mr-1 inline-block" />
                )}
                {entry.description || entry.name}
              </div>
              <div
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <ActionMenu
                  label="卡片操作"
                  disabled={busy}
                  items={[{ label: "打开", run: onOpen }, ...actions]}
                />
              </div>
            </div>
            <p
              ref={preview}
              data-testid="memory-card-body"
              className="line-clamp-6 whitespace-pre-wrap break-words text-xs leading-4 text-foreground-muted theme-brutal:text-black/55"
            >
              {error ? "正文读取失败" : (body ?? "正在读取正文…")}
            </p>
            {error && (
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setRetry((v) => v + 1);
                }}
              >
                重试读取正文
              </Button>
            )}
            {clipped && (
              <span className="text-xs text-foreground-muted">查看全文</span>
            )}
            <div
              data-testid="memory-card-metadata"
              className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5"
            >
              <Badge
                appearance="soft"
                variant="information"
                uppercase={false}
                className="max-w-full truncate"
              >
                {channelName}
              </Badge>
              <Badge
                appearance="soft"
                variant="muted"
                uppercase={false}
                className="max-w-full truncate"
              >
                {entry.name}
              </Badge>
              <Badge
                appearance="soft"
                variant={
                  entry.state === "active"
                    ? "success"
                    : entry.state === "deleted"
                      ? "muted"
                      : "warning"
                }
                uppercase={false}
              >
                {entry.state === "active"
                  ? "有效"
                  : entry.state === "deleted"
                    ? "已删除"
                    : "已失效"}
              </Badge>
              {entry.pinned && (
                <Badge appearance="soft" variant="accent" uppercase={false}>
                  已置顶
                </Badge>
              )}
            </div>
          </div>
        </Card>
      </SidebarContextMenu>
    </div>
  );
}
