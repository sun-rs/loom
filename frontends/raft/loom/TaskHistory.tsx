import { useEffect, useMemo, useState, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "raft-ui";
import { useIntl } from "react-intl";
import type { RahClient } from "@rah-os/client-sdk";
import type { Principal } from "@rah-os/protocol";
import { HistoryTimeline } from "../packages/web/src/components/task/HistoryTimeline.tsx";
import { TaskHistoryReader, toTaskHistoryEvent } from "./task-history.ts";
export default function TaskHistory({
  client,
  roomId,
  taskId,
  taskNumber,
  members,
  revision,
}: {
  client: RahClient;
  roomId: string;
  taskId: string;
  taskNumber: number;
  members: readonly Principal[];
  revision: string;
}) {
  const { formatMessage } = useIntl();
  const reader = useMemo(
    () => new TaskHistoryReader(client, roomId, taskId),
    [client, roomId, taskId],
  );
  const activeRead = useRef<AbortController | undefined>(undefined);
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    activeRead.current = controller;
    setLoading(true);
    setError(false);
    void reader
      .refresh(controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setVersion((v) => v + 1);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reader, open, revision]);
  const resolveName = (_type: "agent" | "user", id: string) => {
    const p = members.find((m) => m.principalId === id);
    return p?.displayName ?? p?.handle ?? "已离开的成员";
  };
  return (
    <div
      className="mb-4 border-b border-line-muted  pb-3"
      data-testid="task-history"
    >
      <button
        type="button"
        className="mb-1 flex w-full items-center gap-1 text-left text-xs font-bold"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="task-history-toggle"
      >
        <span>{formatMessage({ id: "task.properties.history" })}</span>
        {open ? (
          <ChevronDown size={14} aria-hidden="true" />
        ) : (
          <ChevronRight size={14} aria-hidden="true" />
        )}
      </button>
      {open && (
        <div className="mt-3 w-full" data-version={version}>
          {error ? (
            <p role="alert" className="text-xs text-warning-strong">
              {formatMessage({ id: "task.history.error" })}
            </p>
          ) : loading ? (
            <p role="status" className="text-xs text-foreground-muted">
              加载中…
            </p>
          ) : reader.events.length === 0 ? (
            <p className="text-xs text-foreground-muted ">
              {formatMessage({ id: "task.history.empty" })}
            </p>
          ) : (
            <>
              <HistoryTimeline
                history={reader.events.map((e) =>
                  toTaskHistoryEvent(e, taskNumber, members),
                )}
                resolveName={resolveName}
              />
              {reader.nextCursor && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reader.events.length >= 500}
                  onClick={() => {
                    setLoading(true);
                    const signal = activeRead.current?.signal;
                    void reader
                      .older(signal)
                      .then(() => {
                        if (!signal?.aborted) setVersion((v) => v + 1);
                      })
                      .catch(() => {
                        if (!signal?.aborted) setError(true);
                      })
                      .finally(() => {
                        if (!signal?.aborted) setLoading(false);
                      });
                  }}
                >
                  {reader.events.length >= 500
                    ? "已显示500条历史"
                    : "加载更早历史"}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
