// Loom diagnostic text binding; the official dependency owns timeline geometry.
import { useState } from "react";
import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";
import { Badge } from "raft-ui";
import {
  LogItem,
  LOG_TITLE_CLASS,
  LOG_DETAIL_CLASS,
} from "./OfficialActivity.generated";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter";
export default function TrajectoryRow({
  record,
  name,
}: {
  record: RuntimeTrajectoryRecord;
  name?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { formatShortDateTime, formatClockWithSeconds } = useTimeFormatter();
  const e = record.entry;
  const title =
    e.kind === "tool_start"
      ? e.toolName
      : e.kind === "thinking"
        ? "思考"
        : e.kind === "text"
          ? "输出"
          : e.kind === "status"
            ? (e.detailKind ?? e.activity)
            : e.kind === "compaction_started"
              ? "上下文压缩开始"
              : e.kind === "compaction_finished"
                ? "上下文压缩结束"
                : "title" in e
                  ? e.title
                  : e.kind;
  const text =
    e.kind === "tool_start"
      ? (e.toolInput ?? "")
      : e.kind === "status"
        ? (e.detail ?? "")
        : "text" in e
          ? e.text
          : "";
  return (
    <LogItem
      presence={
        e.kind === "thinking" || e.kind === "tool_start"
          ? "busy"
          : e.kind === "text"
            ? "online"
            : "offline"
      }
      timestamp={Date.parse(record.observedAt)}
      formatTimestamp={(t) =>
        name
          ? formatShortDateTime(new Date(t).toISOString())
          : formatClockWithSeconds(new Date(t).toISOString())
      }
    >
      <div data-testid={name ? "role-activity-row" : "loom-trajectory-row"}>
        {name && <div className="text-footnote font-semibold">{name}</div>}
        <button
          type="button"
          className={LOG_TITLE_CLASS}
          aria-expanded={
            text.length > 200 && e.kind !== "tool_start" ? expanded : undefined
          }
          onClick={() =>
            text.length > 200 &&
            e.kind !== "tool_start" &&
            setExpanded((v) => !v)
          }
        >
          {title}
        </button>
        {e.subagent && (
          <Badge appearance="outline">
            子代理
            {e.subagent.subagentType ? ` · ${e.subagent.subagentType}` : ""}
          </Badge>
        )}
        {text && (
          <p
            className={`${LOG_DETAIL_CLASS} whitespace-pre-wrap ${text.length > 200 && e.kind !== "tool_start" && !expanded ? "line-clamp-2" : ""}`}
          >
            {text}
          </p>
        )}
      </div>
    </LogItem>
  );
}
