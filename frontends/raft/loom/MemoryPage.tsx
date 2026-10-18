// Local channel-memory binding; native Sidebar / PanelHeader / form primitives.
import { useEffect, useMemo, useState } from "react";
import {
  AppShellMainSlot,
  ActivityInboxPanel,
  Button,
  Textarea,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogClose,
} from "raft-ui";
import { Brain, X } from "lucide-react";
import type { RahClient } from "@rah-os/client-sdk";
import type { MemoryEntry, MemoryEntryDetail, Room } from "@rah-os/protocol";
import PanelHeader from "../packages/web/src/components/ui/PanelHeader.tsx";
import PanelResizeHandle from "../packages/web/src/components/ui/PanelResizeHandle.tsx";
import FormField from "../packages/web/src/components/ui/FormField.tsx";
import { useResizablePanel } from "../packages/web/src/hooks/useResizablePanel.ts";
import { MASTER_DETAIL_COMPACT_PANEL_BOUNDS } from "../packages/web/src/components/layout/masterDetailPanelSizing.ts";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
import MemoryCard, { type MemoryAction } from "./MemoryCard.tsx";
import MemoryHistory from "./MemoryHistory.tsx";
import MemoryEditor from "./MemoryEditor.tsx";
import MemoryFilters from "./MemoryFilters.tsx";
import { ActionMenu } from "./ManagementUi.tsx";
import { MemoryClient } from "./memory-client.ts";
import { useRouteIntentOwner, useIntentRoute } from "./useIntentRoute.ts";
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
    [detail, setDetail] = useState<MemoryEntryDetail>(),
    [detailError, setDetailError] = useState("");
  const [params, setParams] = useIntentRoute();
  const selected = params.get("memory") ?? "";
  const setSelected = (id: string) => {
    const next = new URLSearchParams(params);
    if (id) next.set("memory", id);
    else next.delete("memory");
    setParams(next);
  };
  const [action, setAction] = useState<"delete" | "invalidate">(),
    [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const [editRequested, setEditRequested] = useState("");
  const [actionTarget, setActionTarget] = useState<MemoryEntry>();
  const busy = state !== "idle";
  const channels = rooms.filter((r) => !r.instancePrivateBox && !r.side);
  const ids = channels
    .filter((r) => channel === "all" || r.roomId === channel)
    .map((r) => r.roomId)
    .join("\n");
  const desktop = useMediaQuery("(min-width: 768px)");
  const wide = useMediaQuery("(min-width: 1024px)");
  const fullPanel = useResizablePanel({
    storageKey: "loom:memoryPanelWidth",
    min: 400,
    max: 720,
    defaultWidth: 560,
  });
  const compactPanel = useResizablePanel({
    storageKey: "loom:memoryCompactWidth",
    ...MASTER_DETAIL_COMPACT_PANEL_BOUNDS,
  });
  const panel = wide ? fullPanel : compactPanel;
  useEffect(() => {
    if (
      editRequested &&
      detail?.entryId === editRequested &&
      selected === editRequested
    ) {
      setEditing(true);
      setEditRequested("");
    }
  }, [detail, editRequested, selected]);
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
    entry: MemoryEntry | undefined = detail,
  ) => {
    if (!entry || busy) return;
    setError("");
    void owner.change(kind, entry, reason, (outcome) => {
      if (outcome.kind === "ok") {
        setAction(undefined);
        setReason("");
        if (kind === "delete" && selected === entry.entryId) setSelected("");
        setVersion((v) => v + 1);
      } else
        setError(
          outcome.kind === "unknown"
            ? "操作结果未知，请核实原操作或放弃。"
            : "操作未完成，可能已被修改。请刷新后重新检查。",
        );
    });
  };
  const actionsFor = (entry: MemoryEntry): MemoryAction[] =>
    entry.state === "deleted"
      ? []
      : [
          {
            label: "编辑",
            disabled: entry.state !== "active",
            run: () => {
              if (selected !== entry.entryId) setSelected(entry.entryId);
              setEditRequested(entry.entryId);
            },
          },
          {
            label: entry.pinned ? "取消置顶" : "置顶",
            run: () => change(entry.pinned ? "unpin" : "pin", entry),
          },
          {
            label: entry.state === "active" ? "标为失效" : "恢复",
            run: () => {
              if (entry.state !== "active") change("restore", entry);
              else {
                setActionTarget(entry);
                setReason("");
                setAction("invalidate");
              }
            },
          },
          {
            label: "删除",
            run: () => {
              setActionTarget(entry);
              setReason("");
              setAction("delete");
            },
          },
        ];
  const reset = () => {
    if (!busy) {
      setSelected("");
      setAction(undefined);
    }
  };
  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-testid="loom-memory-page">
      <AppShellMainSlot
        data-testid="memory-master"
        className={`relative min-w-0 bg-layer-canvas theme-brutal:bg-white ${selected && desktop ? "border-r border-line-muted theme-brutal:border-black" : ""}`}
        style={
          selected
            ? desktop
              ? { flex: `0 0 ${panel.width}px`, width: panel.width }
              : { display: "none" }
            : undefined
        }
      >
        <ActivityInboxPanel edge="attached">
          <PanelHeader title="记忆" icon={<Brain size={18} />} />
          <MemoryFilters
            query={query}
            onQuery={(v) => {
              setQuery(v);
              if (v.trim()) setFilter("active");
              reset();
            }}
            channel={channel}
            onChannel={(v) => {
              setChannel(v);
              reset();
            }}
            channels={channels.map((r) => ({ value: r.roomId, label: r.name }))}
            filter={filter}
            onFilter={(v) => {
              setFilter(v);
              reset();
            }}
            busy={busy}
            onRefresh={() => setVersion((v) => v + 1)}
          />
          <div
            data-testid="loom-memory-list"
            className="scrollbar-quiet relative min-h-0 flex-1 overflow-y-auto bg-layer-canvas-muted p-4 mobile-nav-clearance theme-brutal:bg-white"
          >
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
            {state === "unknown" && !selected && (
              <div className="mb-3 flex gap-2">
                <Button onClick={() => void owner.writes.retry()}>
                  核实原操作
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    owner.writes.discard();
                    setVersion((v) => v + 1);
                  }}
                >
                  放弃核实
                </Button>
              </div>
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
                  .map(
                    (id) => channels.find((r) => r.roomId === id)?.name ?? id,
                  )
                  .join("、")}
                。请刷新重试。
              </p>
            )}
            {result?.truncated && (
              <p role="status" className="px-2 text-sm">
                结果未全部展示，请缩小频道或搜索范围。
              </p>
            )}
            <div className="flex flex-col gap-2">
              {result?.entries.map((entry) => (
                <MemoryCard
                  key={entry.entryId}
                  entry={entry}
                  client={client}
                  channelName={
                    channels.find((r) => r.roomId === entry.channelId)?.name
                  }
                  active={selected === entry.entryId}
                  busy={busy}
                  onOpen={() => setSelected(entry.entryId)}
                  actions={actionsFor(entry)}
                />
              ))}
            </div>
          </div>
        </ActivityInboxPanel>
        {selected && desktop && (
          <PanelResizeHandle
            side="right"
            visibleFrom="md"
            onPointerDown={panel.handleResizeStart}
            onPointerMove={panel.handleResizeMove}
            onPointerUp={panel.handleResizeEnd}
            onPointerCancel={panel.handleResizeEnd}
          />
        )}
      </AppShellMainSlot>
      {selected && (
        <AppShellMainSlot
          data-testid="memory-detail"
          className="@container min-w-0 bg-layer-panel"
        >
          <PanelHeader
            title={detail?.name ?? (selected ? "记忆详情" : "选择记忆")}
            icon={<Brain size={18} />}
            onMobileBack={busy ? undefined : reset}
            mobileBackProps={{ "aria-label": "记忆列表" }}
            actions={
              <>
                {detail && detail.state !== "deleted" && (
                  <>
                    <div className="hidden @[600px]:flex items-center gap-1">
                      {actionsFor(detail).map((item) => (
                        <Button
                          key={item.label}
                          size="sm"
                          variant="outline"
                          disabled={busy || item.disabled}
                          onClick={item.run}
                        >
                          {item.label}
                        </Button>
                      ))}
                    </div>
                    <div className="@[600px]:hidden">
                      <ActionMenu
                        label="记忆操作"
                        disabled={busy}
                        items={actionsFor(detail)}
                      />
                    </div>
                  </>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="关闭记忆正文"
                  disabled={busy}
                  onClick={reset}
                >
                  <X size={16} />
                </Button>
              </>
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
      )}
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
              onClick={() => action && change(action, actionTarget)}
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
