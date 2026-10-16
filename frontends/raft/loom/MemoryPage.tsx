// Local channel-memory binding; native Sidebar / PanelHeader / form primitives.
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  AppShellMainSlot,
  AppShellSidebarSlot,
  Button,
  Input,
  SidebarItem,
  Textarea,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogClose,
} from "raft-ui";
import { Brain, Pin, RefreshCw } from "lucide-react";
import type { RahClient } from "@rah-os/client-sdk";
import type { MemoryEntryDetail, Room } from "@rah-os/protocol";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import PanelResizeHandle from "../packages/web/src/components/ui/PanelResizeHandle.tsx";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import { SIDEBAR_PANEL_BOUNDS } from "../packages/web/src/lib/panelBounds.ts";
import MemoryHistory from "./MemoryHistory.tsx";
import MemoryEditor from "./MemoryEditor.tsx";
import Frame from "./ChatSidebarFrame.tsx";
import { SelectField, ActionMenu } from "./ManagementUi.tsx";
import { MemoryClient } from "./memory-client.ts";
import { useRouteIntentOwner } from "./useIntentRoute.ts";
export default function MemoryPage({
  client,
  rooms,
}: {
  client: RahClient;
  rooms: Room[];
}) {
  const owner = useMemo(() => new MemoryClient(client), [client]);
  const [state, setState] = useState(owner.writes.state),
    [channel, setChannel] = useState("all"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("active"),
    [version, setVersion] = useState(0);
  const [result, setResult] =
      useState<Awaited<ReturnType<MemoryClient["list"]>>>(),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<MemoryEntryDetail>(),
    [detailError, setDetailError] = useState("");
  const [action, setAction] = useState<"delete" | "invalidate">(),
    [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const busy = state !== "idle";
  const channels = rooms.filter((r) => !r.instancePrivateBox && !r.side);
  const ids = channels
    .filter((r) => channel === "all" || r.roomId === channel)
    .map((r) => r.roomId)
    .join("\n");
  const panel = useResizablePanel({
    storageKey: "loom:memorySidebarWidth",
    ...SIDEBAR_PANEL_BOUNDS,
  });
  useRouteIntentOwner(owner.writes);
  useEffect(() => {
    const stop = owner.writes.onChange(setState);
    return () => {
      stop();
      owner.writes.discard();
    };
  }, [owner]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setResult(undefined);
    const timer = setTimeout(() => {
      void owner
        .list(ids ? ids.split("\n") : [], query, filter, abort.signal)
        .then((value) => {
          if (!abort.signal.aborted) {
            setResult(value);
            setLoading(false);
          }
        })
        .catch(() => {
          if (!abort.signal.aborted) {
            setError("无法读取记忆，请重试。");
            setLoading(false);
          }
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [owner, ids, query, filter, version]);
  useEffect(() => {
    const abort = new AbortController();
    setDetail(undefined);
    setDetailError("");
    if (selected)
      void client
        .request("memory.read", { entryId: selected }, { signal: abort.signal })
        .then((r) => {
          if (!abort.signal.aborted) setDetail(r.entry);
        })
        .catch(() => {
          if (!abort.signal.aborted)
            setDetailError("无法读取该记忆，请刷新重试。");
        });
    return () => abort.abort();
  }, [client, selected, version]);
  const change = (
    kind: "pin" | "unpin" | "restore" | "invalidate" | "delete",
  ) => {
    if (!detail || busy) return;
    setError("");
    void owner.change(kind, detail, reason, (outcome) => {
      if (outcome.kind === "ok") {
        setAction(undefined);
        setReason("");
        if (kind === "delete") setSelected("");
        setVersion((v) => v + 1);
      } else
        setError(
          outcome.kind === "unknown"
            ? "操作结果未知，请核实原操作或放弃。"
            : "操作未完成，可能已被修改。请刷新后重新检查。",
        );
    });
  };
  const reset = () => {
    if (!busy) {
      setSelected("");
      setAction(undefined);
    }
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-testid="loom-memory-page">
      <AppShellSidebarSlot
        className={`relative shrink-0 flex-col md:flex md:w-[var(--memory-sidebar-width)] ${selected ? "hidden" : "flex w-full"}`}
        style={
          { "--memory-sidebar-width": `${panel.width}px` } as CSSProperties
        }
      >
        <Frame
          title="记忆"
          testIdPrefix="memory-sidebar"
          scrollTestId="loom-memory-list"
        >
          <div className="mb-2 flex items-center gap-2">
            <Input
              aria-label="搜索记忆"
              placeholder="搜索记忆"
              value={query}
              maxLength={200}
              disabled={busy}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value.trim()) setFilter("active");
                reset();
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="刷新记忆"
              disabled={busy}
              onClick={() => setVersion((v) => v + 1)}
            >
              <RefreshCw size={14} />
            </Button>
          </div>
          <SelectField
            label="频道"
            value={channel}
            disabled={busy}
            onChange={(v) => {
              setChannel(v);
              reset();
            }}
            options={[
              { value: "all", label: "全部频道" },
              ...channels.map((r) => ({ value: r.roomId, label: r.name })),
            ]}
          />
          <SelectField
            label="状态"
            value={filter}
            disabled={busy || !!query.trim()}
            onChange={(v) => {
              setFilter(v);
              reset();
            }}
            options={[
              { value: "active", label: "有效" },
              { value: "invalidated", label: "已失效" },
              { value: "deleted", label: "已删除" },
              { value: "all", label: "全部状态" },
            ]}
          />
          {query.trim() && (
            <p className="px-2 mb-2 text-xs text-foreground-muted">
              全文搜索仅包含有效记忆。
            </p>
          )}
          {error && !selected && (
            <p role="alert" className="px-2 text-sm">
              {error}
            </p>
          )}
          {loading ? (
            <p role="status" className="px-2 text-sm">
              正在读取记忆…
            </p>
          ) : !result?.entries.length ? (
            <p className="px-2 text-sm">没有匹配的记忆</p>
          ) : null}
          {!!result?.failed.length && (
            <p role="alert" className="px-2 text-sm">
              部分频道读取失败：
              {result.failed
                .map((id) => channels.find((r) => r.roomId === id)?.name ?? id)
                .join("、")}
              。请刷新重试。
            </p>
          )}
          {result?.truncated && (
            <p role="status" className="px-2 text-sm">
              结果未全部展示，请缩小频道或搜索范围。
            </p>
          )}
          {result?.entries.map((entry) => (
            <SidebarItem
              key={entry.entryId}
              variant="accent"
              active={selected === entry.entryId}
              disabled={busy}
              aria-label={entry.name}
              onClick={() => setSelected(entry.entryId)}
              className="mx-0 w-full items-start"
            >
              <Brain size={16} className="mt-1 shrink-0" />
              <div className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1">
                  <span className="truncate text-sm">{entry.name}</span>
                  {entry.pinned && <Pin size={12} />}
                </div>
                <p className="truncate text-xs text-foreground-muted">
                  {entry.description}
                </p>
                <p className="truncate text-xs text-foreground-muted">
                  {channels.find((r) => r.roomId === entry.channelId)?.name} ·{" "}
                  {entry.state === "active"
                    ? "有效"
                    : entry.state === "deleted"
                      ? "已删除"
                      : "已失效"}
                </p>
              </div>
            </SidebarItem>
          ))}
        </Frame>
        <PanelResizeHandle
          side="right"
          visibleFrom="md"
          onPointerDown={panel.handleResizeStart}
          onPointerMove={panel.handleResizeMove}
          onPointerUp={panel.handleResizeEnd}
          onPointerCancel={panel.handleResizeEnd}
        />
      </AppShellSidebarSlot>
      <AppShellMainSlot
        className={`min-w-0 bg-layer-panel md:flex ${selected ? "flex" : "hidden"}`}
      >
        <PanelHeader
          title={detail?.name ?? (selected ? "记忆详情" : "选择记忆")}
          icon={<Brain size={18} />}
          onMobileBack={busy ? undefined : reset}
          mobileBackProps={{ "aria-label": "记忆列表" }}
          actions={
            detail && detail.state !== "deleted" ? (
              <ActionMenu
                label="记忆操作"
                disabled={busy}
                items={[
                  {
                    label: "编辑",
                    run: () => setEditing(true),
                    disabled: detail.state !== "active",
                  },
                  {
                    label: detail.pinned ? "取消置顶" : "置顶",
                    run: () => change(detail.pinned ? "unpin" : "pin"),
                  },
                  {
                    label: detail.state === "active" ? "标为失效" : "恢复",
                    run: () =>
                      detail.state === "active"
                        ? (setReason(""), setAction("invalidate"))
                        : change("restore"),
                  },
                  {
                    label: "删除",
                    run: () => {
                      setReason("");
                      setAction("delete");
                    },
                  },
                ]}
              />
            ) : undefined
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {detailError && <p role="alert">{detailError}</p>}
          {selected && !detail && !detailError && (
            <p role="status">正在读取正文…</p>
          )}
          {!selected && (
            <p className="text-sm text-foreground-muted">
              选择一条记忆查看内容。记忆按频道共享。
            </p>
          )}
          {detail && (
            <>
              <p className="mb-4 text-sm text-foreground-muted">
                {channels.find((r) => r.roomId === detail.channelId)?.name} ·
                修订 {detail.revision} · {detail.updatedAt}
              </p>
              <FormField label="简介">
                <p className="text-sm whitespace-pre-wrap">
                  {detail.description}
                </p>
              </FormField>
              <FormField label="正文" className="mt-4">
                <div className="text-sm whitespace-pre-wrap break-words">
                  {detail.body ?? "正文已删除"}
                </div>
              </FormField>
              <p className="mt-5 text-xs text-foreground-muted">
                来源：
                {detail.provenance.actorKind === "human" ? "Human" : "实例"}
                {detail.provenance.modelBindingId
                  ? ` · ${detail.provenance.modelBindingId}`
                  : ""}
              </p>
              <MemoryHistory
                key={`${detail.entryId}:${detail.revision}`}
                client={client}
                entryId={detail.entryId}
              />
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm">
              {error}
            </p>
          )}
          {state === "unknown" && (
            <div className="mt-3 flex gap-2">
              <Button onClick={() => void owner.writes.retry()}>
                核实原操作
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  owner.writes.discard();
                  setAction(undefined);
                  setVersion((v) => v + 1);
                }}
              >
                放弃核实
              </Button>
            </div>
          )}
        </div>
      </AppShellMainSlot>
      {editing && detail && (
        <MemoryEditor
          entry={detail}
          owner={owner}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action === "delete" ? "删除记忆" : "标为失效"}
            </DialogTitle>
            <DialogClose disabled={busy} aria-label="关闭记忆操作" />
          </DialogHeader>
          <DialogBody>
            <p className="mb-3 text-sm">
              {action === "delete"
                ? "删除会清空平台在线读取的正文及历史修订；已进入模型会话、诊断或备份的副本不会被追溯清理。"
                : "失效后不再作为有效记忆提供给实例，可随时恢复。"}
            </p>
            <FormField label="原因">
              <Textarea
                aria-label="原因"
                value={reason}
                maxLength={500}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
              />
            </FormField>
            <Button
              className="mt-3"
              disabled={busy || !reason.trim()}
              onClick={() => action && change(action)}
            >
              确认{action === "delete" ? "删除" : "失效"}
            </Button>
            {error && <p role="alert">{error}</p>}
            {state === "unknown" && (
              <div className="mt-3 flex gap-2">
                <Button onClick={() => void owner.writes.retry()}>
                  核实原操作
                </Button>
                <Button
                  onClick={() => {
                    owner.writes.discard();
                    setAction(undefined);
                    setVersion((v) => v + 1);
                  }}
                >
                  放弃核实
                </Button>
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
