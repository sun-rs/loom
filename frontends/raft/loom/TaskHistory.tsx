import { OfficialTaskHistoryFrame } from "./OfficialTaskSurfaces.generated";
import { useEffect, useMemo, useState, useRef } from "react";
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
    <OfficialTaskHistoryFrame
      historyOpen={open}
      toggleHistory={() => setOpen((v) => !v)}
    >
      <div data-version={version}>
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
    </OfficialTaskHistoryFrame>
  );
}
