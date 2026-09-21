import { LoadingState } from "@rah-os/ui-web/neo-brutalist/loading-state";
import { useWorkspaceEntities } from "./workspace-entity-context.tsx";
import { useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { Principal, Task } from "@rah-os/protocol";
import { useDiscoveryQuery } from "../use-discovery-query.ts";
import { formatRahDateTime } from "../date-time-presentation.ts";
import {
  historyStatuses,
  taskAmendmentDetails,
  taskHistoryOperations,
} from "../task-history-presentation.ts";

/** Structural port of Raft npt/spt: canonical operations, not discussion text. */
export function TaskDetailHistory({
  client,
  task,
  people,
}: {
  client: RahClient;
  task: Task;
  people: readonly Principal[];
}) {
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const cursor = cursors.at(-1);
  const result = useDiscoveryQuery(client, "task.history", {
    roomId: task.roomId,
    taskId: task.taskId,
    limit: 50,
    ...(cursor ? { cursor } : {}),
  });
  const rows = taskHistoryOperations(result.data?.events ?? []);
  const entities = useWorkspaceEntities();
  const name = (id: string | null | undefined) => {
    if (!id) return "未指派";
    const candidate = people.find((person) => person.principalId === id);
    const person = candidate
      ? (entities?.resolvePerson(candidate) ?? candidate)
      : entities?.person(id);
    return person?.displayName || person?.handle || "未知成员";
  };
  return (
    <div className="rah-task-detail-history-body">
      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <div role="alert">
          <p>无法加载操作时间线：{result.error}</p>
          <button className="btn" onClick={result.refresh}>
            重试
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p>暂无操作记录</p>
      ) : (
        <ol>
          {rows.map(({ event, title, status }) => (
            <li
              key={`${event.eventId}:${title}`}
              data-tone={status ? historyStatuses[status].tone : undefined}
            >
              <span
                aria-hidden="true"
                className={`rah-task-history-dot${status ? ` is-${historyStatuses[status].tone}` : ""}`}
              />
              <div>
                <b>{title}</b>
                <span className="rah-task-history-meta">
                  {name(event.actorId)} ·{" "}
                  {formatRahDateTime(event.createdAt, {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                {event.type === "task.created" ? (
                  <p>
                    任务号：{task.taskNumber} · 状态：
                    {historyStatuses[status ?? "todo"].label}
                  </p>
                ) : title === "变更负责人" ? (
                  <p>
                    {event.assigneeId == null &&
                    event.type !== "task.claimed" ? (
                      "取消指派"
                    ) : (
                      <>
                        负责人：
                        {name(
                          event.assigneeId ??
                            (event.type === "task.claimed"
                              ? event.actorId
                              : undefined),
                        )}
                      </>
                    )}
                  </p>
                ) : status && event.previousWorkflowStatus ? (
                  <p className="rah-task-history-transition">
                    <span
                      className={`chip-${historyStatuses[event.previousWorkflowStatus].tone}`}
                    >
                      {historyStatuses[event.previousWorkflowStatus].label}
                    </span>
                    <span>→</span>
                    <span className={`chip-${historyStatuses[status].tone}`}>
                      {historyStatuses[status].label}
                    </span>
                  </p>
                ) : event.changes ? (
                  <p>{taskAmendmentDetails(event.changes)}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="rah-task-detail-history-pager">
        {cursors.length > 1 ? (
          <button
            className="btn"
            disabled={result.loading}
            onClick={() => setCursors((v) => v.slice(0, -1))}
          >
            较新记录
          </button>
        ) : null}
        {result.data?.nextCursor ? (
          <button
            className="btn"
            disabled={result.loading}
            onClick={() => setCursors((v) => [...v, result.data!.nextCursor!])}
          >
            更早记录
          </button>
        ) : null}
      </div>
    </div>
  );
}
