import PageEmpty from "./PageEmpty";
import { useEffect, useState } from "react";
import type { RahClient } from "@rah-os/client-sdk";
import {
  Button,
  Spinner,
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
import TrajectoryRow from "./TrajectoryRow.tsx";
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
            <PageEmpty
              kind={data.failed.length ? "unavailable" : "activity"}
              className="py-16"
            />
          )}
          <ul className="px-5 py-3">
            {data.rows.map((row) => (
              <TrajectoryRow
                key={`${row.source.agentId}:${row.record.activityId}`}
                record={row.record}
                name={row.source.name}
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
