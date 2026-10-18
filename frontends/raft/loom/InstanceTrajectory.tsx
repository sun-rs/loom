import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import type { RuntimeTrajectoryRecord } from "@rah-os/protocol";
import { Button, Spinner, Badge } from "raft-ui";
import { ChevronRight } from "lucide-react";
import StatusDot from "../packages/web/src/components/ui/StatusDot.tsx";
import SectionEyebrow from "../packages/web/src/components/ui/SectionEyebrow.tsx";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter.ts";
import { loadTrajectory } from "./run-details.ts";
/** Structural port of AgentActivityLog rows; no provider parsing or inferred business state. */
function Entry({ record }: { record: RuntimeTrajectoryRecord }) {
  const [expanded, setExpanded] = useState(false);
  const { formatClockWithSeconds } = useTimeFormatter();
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
  const long = text.length > 200;
  return (
    <div
      data-testid="loom-trajectory-row"
      className="flex items-start gap-2 py-1.5 px-3 hover:bg-fill-muted  transition-colors"
    >
      <span className="shrink-0 font-mono text-xs text-foreground-placeholder  mt-0.5 whitespace-nowrap">
        {formatClockWithSeconds(record.observedAt)}
      </span>
      <StatusDot
        size="sm"
        tone={
          e.kind === "thinking" || e.kind === "tool_start"
            ? "bg-status-busy"
            : e.kind === "text"
              ? "bg-brutal-cyan"
              : "bg-brutal-orange"
        }
        className="mt-1.5"
      />
      <div className="text-sm min-w-0 flex-1">
        {e.kind === "tool_start" ? (
          <span className="font-medium text-foreground-strong ">{title}</span>
        ) : (
          <button
            type="button"
            aria-expanded={long ? expanded : undefined}
            onClick={() => long && setExpanded((v) => !v)}
            className={`flex items-center gap-1 font-medium text-foreground-strong  ${long ? "hover:text-foreground-muted " : "cursor-default"}`}
          >
            {title}
            {long && (
              <ChevronRight
                size={12}
                className={`transition-transform ${expanded ? "rotate-90" : ""}`}
              />
            )}
          </button>
        )}
        {e.subagent && (
          <Badge
            appearance="outline"
            variant="default"
            className="ml-1.5 font-mono align-middle"
          >
            子代理
            {e.subagent.subagentType ? ` · ${e.subagent.subagentType}` : ""}
          </Badge>
        )}
        {e.kind === "tool_start"
          ? text && (
              <span className="text-foreground-muted  ml-1.5 font-mono text-xs break-all">
                {text}
              </span>
            )
          : text && (
              <p
                className={`text-foreground-muted  text-xs font-mono mt-0.5 whitespace-pre-wrap break-words ${long && !expanded ? "line-clamp-2" : ""}`}
              >
                {text}
              </p>
            )}
      </div>
    </div>
  );
}
export default function InstanceTrajectory({
  client,
  agentId,
  instanceId,
  roomId,
}: {
  client: RahClient;
  agentId: string;
  instanceId: string;
  roomId: string;
}) {
  const [cursor, setCursor] = useState<string>();
  const [data, setData] =
    useState<Awaited<ReturnType<typeof loadTrajectory>>>();
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setData(undefined);
    setError("");
    const read = async () => {
      try {
        const value = await loadTrajectory(
          client,
          { agentId, instanceId, roomId, beforeActivityId: cursor },
          abort.signal,
        );
        if (!abort.signal.aborted) {
          setData(value);
          setError("");
        }
      } catch {
        if (!abort.signal.aborted) {
          setData(undefined);
          setError("工具轨迹暂时无法读取，正在重试。");
        }
      } finally {
        if (!abort.signal.aborted)
          timer = setTimeout(read, document.hidden ? 15000 : 3000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, agentId, instanceId, roomId, cursor]);
  return (
    <section data-testid="loom-trajectory">
      <div className="border-b border-line-muted px-5 py-2">
        <SectionEyebrow as="div">工具与执行轨迹</SectionEyebrow>
      </div>
      {error ? (
        <p role="alert" className="px-3 text-sm">
          {error}
        </p>
      ) : !data ? (
        <Spinner aria-label="读取工具轨迹" />
      ) : (
        <>
          {data.activities.length === 0 ? (
            <p className="px-3 py-2 text-sm text-foreground-muted">
              本页无本对话轨迹；未记录不代表没有工具调用。
            </p>
          ) : (
            data.activities.map((record) => (
              <Entry key={record.activityId} record={record} />
            ))
          )}
          <div className="flex gap-2 px-3 py-2">
            {cursor && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCursor(undefined)}
              >
                最新轨迹
              </Button>
            )}
            {data.nextCursor && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCursor(data.nextCursor)}
              >
                更早轨迹
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
