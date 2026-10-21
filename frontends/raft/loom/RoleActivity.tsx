import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import {
  Button,
  Spinner,
  Badge,
  Select,
  SelectTrigger,
  SelectValue,
  SelectIcon,
  SelectContent,
  SelectList,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
  PickerTriggerButton,
} from "raft-ui";
import { loadRoleActivity, type ActivitySource } from "./role-activity.ts";
import {
  LogItem,
  LOG_TITLE_CLASS,
  LOG_DETAIL_CLASS,
} from "./OfficialActivity.generated";
import { useTimeFormatter } from "../packages/web/src/hooks/useTimeFormatter";
function ActivityRow({
  row,
}: {
  row: Awaited<ReturnType<typeof loadRoleActivity>>["rows"][number];
}) {
  const [expanded, setExpanded] = useState(false);
  const { formatShortDateTime } = useTimeFormatter();
  const e = row.record.entry;
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
      timestamp={Date.parse(row.record.observedAt)}
      formatTimestamp={(t) => formatShortDateTime(new Date(t).toISOString())}
    >
      <div data-testid="role-activity-row">
        <div className="text-footnote font-semibold">{row.source.name}</div>
        <button
          type="button"
          className={LOG_TITLE_CLASS}
          aria-expanded={text.length > 200 ? expanded : undefined}
          onClick={() => setExpanded((v) => !v)}
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
            className={`${LOG_DETAIL_CLASS} whitespace-pre-wrap ${text.length > 200 && !expanded ? "line-clamp-2" : ""}`}
          >
            {text}
          </p>
        )}
      </div>
    </LogItem>
  );
}
export default function RoleActivity({
  client,
  sources,
  active,
}: {
  client: RahClient;
  sources: ActivitySource[];
  active: boolean;
}) {
  const [selected, setSelected] = useState("all"),
    [cursor, setCursor] = useState<string>();
  const [data, setData] =
    useState<Awaited<ReturnType<typeof loadRoleActivity>>>();
  const options = [
    { value: "all", label: "全部实例" },
    ...sources.map((s) => ({ value: s.agentId, label: s.name })),
  ];
  const sourceKey = JSON.stringify(sources);
  useEffect(() => {
    if (!active) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const all = JSON.parse(sourceKey) as ActivitySource[];
    const chosen =
      selected === "all" ? all : all.filter((s) => s.agentId === selected);
    setData(undefined);
    const read = async () => {
      try {
        const result = await loadRoleActivity(
          client,
          chosen,
          abort.signal,
          cursor,
        );
        if (!abort.signal.aborted) setData(result);
      } catch {
        if (!abort.signal.aborted)
          setData({
            rows: [],
            failed: chosen.map((s) => s.name),
            nextCursor: undefined,
          });
      } finally {
        if (!abort.signal.aborted)
          timer = setTimeout(read, document.hidden ? 30000 : 10000);
      }
    };
    void read();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [client, sourceKey, selected, cursor, active]);
  return (
    <section data-testid="role-activity">
      <div className="px-5 py-3 border-b border-line-seam">
        <Select
          value={selected}
          items={options}
          onValueChange={(v) => {
            if (v !== null) {
              setSelected(v);
              setCursor(undefined);
            }
          }}
        >
          <SelectTrigger aria-label="实例动态" render={<PickerTriggerButton />}>
            <SelectValue />
            <SelectIcon />
          </SelectTrigger>
          <SelectContent>
            <SelectList>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <SelectItemText>{option.label}</SelectItemText>
                  <SelectItemIndicator />
                </SelectItem>
              ))}
            </SelectList>
          </SelectContent>
        </Select>
        <p className="text-caption text-foreground-hint">
          {selected === "all"
            ? "汇总各实例最近 50 条记录，最多显示 100 条；选择实例可查看更早记录。"
            : "显示所选实例的执行记录。"}
          未记录不代表没有执行。
        </p>
      </div>
      {!data ? (
        <Spinner aria-label="读取实例动态" />
      ) : (
        <>
          {data.failed.length > 0 && (
            <p role="alert" className="px-5 py-2">
              部分动态读取失败：{data.failed.join("、")}，正在重试。
            </p>
          )}
          {!data.rows.length && (
            <p className="px-5 py-4 text-foreground-hint">
              {data.failed.length ? "暂未取得动态。" : "暂无已记录动态。"}
            </p>
          )}
          <ul className="px-5 py-3">
            {data.rows.map((row) => (
              <ActivityRow
                key={`${row.source.agentId}:${row.record.activityId}`}
                row={row}
              />
            ))}
          </ul>
          <div className="flex gap-2 px-5 py-3">
            {cursor && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCursor(undefined)}
              >
                最新动态
              </Button>
            )}
            {selected !== "all" && data.nextCursor && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCursor(data.nextCursor)}
              >
                更早动态
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
