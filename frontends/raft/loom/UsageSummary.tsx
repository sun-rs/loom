// Native Settings table/segmented controls. Kernel supplies all totals; no model-price estimation.
import { useEffect, useState } from "react";
import {
  Button,
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlLabel,
} from "raft-ui";
import type { RahClient } from "@rah-os/client-sdk";
import type { UsageSummaryResponse } from "@rah-os/protocol";
import { summaryCells } from "./console-closeout.ts";
const headings = [
  "实例",
  "运行数",
  "输入 token",
  "缓存输入",
  "输出 token",
  "推理输出",
  "费用",
];
export default function UsageSummary({
  client,
  workspaceId,
  controlRoomId,
}: {
  client: RahClient;
  workspaceId: string;
  controlRoomId: string;
}) {
  const [windowDays, setWindowDays] = useState("1"),
    [tick, setTick] = useState(0),
    [data, setData] = useState<UsageSummaryResponse>(),
    [names, setNames] = useState<Map<string, string>>(new Map()),
    [rooms, setRooms] = useState<Map<string, string>>(new Map()),
    [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    setData(undefined);
    setError("");
    const to = new Date();
    void Promise.all([
      client.request(
        "usage.summary",
        {
          groupBy: "instance",
          from: new Date(
            to.getTime() - Number(windowDays) * 86400000,
          ).toISOString(),
          to: to.toISOString(),
        },
        { signal: abort.signal },
      ),
      client.request("role.list", { controlRoomId }, { signal: abort.signal }),
      client.request("agent.list", { controlRoomId }, { signal: abort.signal }),
      client.request("room.list", { workspaceId }, { signal: abort.signal }),
    ])
      .then(([summary, catalog, agents, directory]) => {
        if (abort.signal.aborted) return;
        const agentNames = new Map(
          agents.agents.map((a) => [
            a.definition.agentId,
            a.currentRevision.displayName ?? a.handle,
          ]),
        );
        setNames(
          new Map(
            catalog.instances.map((i) => [
              i.instanceId,
              agentNames.get(i.agentId) ?? "已移除实例",
            ]),
          ),
        );
        setRooms(new Map(directory.rooms.map((r) => [r.roomId, r.name])));
        setData(summary);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("无法读取用量，请重试。");
      });
    return () => abort.abort();
  }, [client, workspaceId, controlRoomId, windowDays, tick]);
  return (
    <section data-testid="loom-usage-summary">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl
          value={windowDays}
          onValueChange={(v) => {
            if (v) setWindowDays(v);
          }}
          aria-label="统计时间"
        >
          <SegmentedControlItem value="1">
            <SegmentedControlLabel>最近 24 小时</SegmentedControlLabel>
          </SegmentedControlItem>
          <SegmentedControlItem value="7">
            <SegmentedControlLabel>最近 7 天</SegmentedControlLabel>
          </SegmentedControlItem>
        </SegmentedControl>
        <Button size="sm" variant="ghost" onClick={() => setTick((v) => v + 1)}>
          刷新用量
        </Button>
      </div>
      <p className="mb-4 text-xs text-foreground-muted">
        按运行开始时间统计。Token 仅汇总已采集记录，费用为 CLI
        自报估值，未知部分不补零。
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <p role="status">正在读取用量…</p>
      ) : (
        <>
          {data.truncated && (
            <p role="status" className="mb-3 text-sm">
              分组结果已截断，合计仍以服务端返回为准。
            </p>
          )}
          <div className="overflow-x-auto">
            <Table aria-label="实例用量汇总">
              <TableHeader>
                <TableRow>
                  {headings.map((h) => (
                    <TableHead key={h}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.groups.map((g, i) => (
                  <TableRow key={`${g.instanceId}:${g.channelId}`}>
                    <TableCell>
                      <div className="whitespace-nowrap font-bold">
                        {names.get(g.instanceId ?? "") ?? `已移除实例 ${i + 1}`}
                      </div>
                      <div className="text-xs text-foreground-muted">
                        {rooms.get(g.channelId) ?? "历史频道"}
                      </div>
                    </TableCell>
                    {summaryCells(g).map((c, index) => (
                      <TableCell
                        key={index}
                        className="whitespace-nowrap tabular-nums"
                      >
                        {c}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-bold">合计</TableCell>
                  {summaryCells(data.totals).map((c, i) => (
                    <TableCell
                      key={i}
                      className="whitespace-nowrap tabular-nums font-bold"
                    >
                      {c}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
          {!data.groups.length && (
            <p className="mt-3 text-sm">此时间范围没有运行记录。</p>
          )}
          <details className="mt-4 text-sm">
            <summary>采集完整性</summary>
            <p className="mt-2">
              完整运行 {data.totals.runs.complete} · 部分运行{" "}
              {data.totals.runs.partial} · 无用量运行{" "}
              {data.totals.runs.unavailable}
            </p>
            {data.totals.gaps.map((g) => (
              <p key={g.reason}>
                {g.reason} · {g.runs} 次运行
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
