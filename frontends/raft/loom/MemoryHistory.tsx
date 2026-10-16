// Structural port of TaskHistory disclosure + official HistoryTimeline primitives.
import { useEffect, useState } from "react";
import {
  Button,
  Timeline,
  TimelineItem,
  TimelineTitle,
  TimelineTime,
  TimelineContent,
} from "raft-ui";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  MemoryHistoryResponse,
  MemoryRevisionOperation,
} from "@rah-os/protocol";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter.ts";
const labels: Record<MemoryRevisionOperation, string> = {
  create: "创建",
  update: "更新",
  invalidate: "标为失效",
  restore: "恢复",
  delete: "删除",
  pin: "置顶",
  unpin: "取消置顶",
};
export default function MemoryHistory({
  client,
  entryId,
}: {
  client: RahClient;
  entryId: string;
}) {
  const [open, setOpen] = useState(false),
    [history, setHistory] = useState<MemoryHistoryResponse>(),
    [error, setError] = useState(false),
    [tick, setTick] = useState(0),
    [expanded, setExpanded] = useState<number>();
  const { formatShortDateTime } = useTimeFormatter();
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setHistory(undefined);
    setError(false);
    setExpanded(undefined);
    void client
      .request("memory.history", { entryId }, { signal: abort.signal })
      .then((result) => {
        if (!abort.signal.aborted) {
          if (result.entry.entryId !== entryId) throw Error("Foreign history");
          setHistory(result);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      });
    return () => abort.abort();
  }, [client, entryId, open, tick]);
  return (
    <div
      className="mt-5 mb-4 border-t border-line-muted theme-brutal:border-black/10 pt-3"
      data-testid="memory-history"
    >
      <button
        type="button"
        className="mb-1 flex w-full items-center gap-1 text-left text-xs font-bold"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        修订历史{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && (
        <div className="mt-3 w-full">
          {error ? (
            <>
              <p role="alert" className="text-xs text-warning-strong">
                无法读取修订历史。
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setTick((v) => v + 1)}
              >
                重试历史
              </Button>
            </>
          ) : !history ? (
            <p role="status" className="text-xs text-foreground-muted">
              正在读取历史…
            </p>
          ) : (
            <>
              <Timeline size="sm">
                {history.revisions.map((row) => (
                  <TimelineItem key={row.revision}>
                    <TimelineTitle>
                      {labels[row.op]} · 修订 {row.revision}
                    </TimelineTitle>
                    <TimelineTime className="text-foreground-muted theme-brutal:text-black/50">
                      {row.provenance.actorKind === "human" ? "Human" : "实例"}{" "}
                      · {formatShortDateTime(row.provenance.recordedAt)}
                      {row.provenance.modelBindingId
                        ? ` · ${row.provenance.modelBindingId}`
                        : ""}
                    </TimelineTime>
                    <TimelineContent>
                      {row.reason && (
                        <p className="text-xs whitespace-pre-wrap">
                          {row.reason}
                        </p>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`查看修订 ${row.revision}`}
                        aria-expanded={expanded === row.revision}
                        onClick={() =>
                          setExpanded(
                            expanded === row.revision
                              ? undefined
                              : row.revision,
                          )
                        }
                      >
                        查看内容
                      </Button>
                      {expanded === row.revision && (
                        <div className="mt-2 text-sm whitespace-pre-wrap break-words">
                          <p className="mb-2 text-foreground-muted">
                            {row.description}
                          </p>
                          <p>{row.body ?? "正文已删除"}</p>
                        </div>
                      )}
                    </TimelineContent>
                  </TimelineItem>
                ))}
              </Timeline>
              {!history.revisions.length && (
                <p className="text-xs text-foreground-muted">暂无修订历史</p>
              )}
              {history.truncated && (
                <p className="mt-3 text-xs text-foreground-muted">
                  仅显示最近 {history.revisions.length} 条修订，更早修订未载入。
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
