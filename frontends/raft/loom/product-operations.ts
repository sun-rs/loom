// Product presentation/transport helpers. Domain state remains in the existing SDK owners.
import type { RahClient } from "@rah-os/client-sdk";
import type {
  Room,
  ClientRoomMutationResponse,
  UsageSummaryResponse,
  ClientRunAttemptUsageGetResponse,
} from "@rah-os/protocol";
import { RUN_ATTEMPT_CLI_COST_READ_LIMIT } from "@rah-os/protocol";
import type {
  WriteIntentSlot,
  IntentOutcome,
} from "@rah-os/client-core/write-intent";
export function saveTaskPermission(
  client: RahClient,
  writes: WriteIntentSlot,
  room: Room,
  basis: number,
  enabled: boolean,
  onSettled: (outcome: IntentOutcome<ClientRoomMutationResponse>) => void,
) {
  // Freeze the version the user saw. Do not refresh the basis under old metadata.
  return writes.submitRevisioned({
    action: "channel-task-permission",
    payload: {
      roomId: room.roomId,
      name: room.name,
      description: room.description,
      visibility: room.visibility ?? "private",
      allowInstanceTaskCreation: enabled,
      basedOnRoomSeq: basis,
    },
    send: (payload, idempotencyKey) =>
      client.request("room.update", { ...payload, idempotencyKey }),
    onSettled,
  });
}
export function summaryCells(figure: UsageSummaryResponse["totals"]) {
  const { runs, tokens, cliEstimatedCost: cost } = figure;
  const partial = runs.unavailable > 0 || runs.partial > 0;
  const token = (n: number | null) =>
    runs.total === 0
      ? "—"
      : runs.complete + runs.partial === 0 || n === null
        ? "未知"
        : n.toLocaleString("zh-CN") + (partial ? "（部分）" : "");
  const costPartial =
    cost.runsPartial > 0 ||
    cost.runsUnknown > 0 ||
    cost.runsUnreported > 0 ||
    runs.unavailable > 0;
  return [
    String(runs.total) +
      (runs.unavailable ? `（无用量 ${runs.unavailable}）` : ""),
    token(tokens.inputTokens),
    token(tokens.cachedInputTokens),
    token(tokens.outputTokens),
    token(tokens.reasoningOutputTokens),
    cost.totalUsd === null
      ? "未知"
      : `$${cost.totalUsd.toFixed(6)}（${costPartial ? "部分，" : ""}CLI 自报）`,
  ];
}
export function diagnosticRows(data: ClientRunAttemptUsageGetResponse) {
  const execution = data.execution,
    final = data.finalInterrupt;
  const measured = data.sessionResumeMs ?? execution?.sessionResumeMs;
  const costs = data.cliCosts ?? [],
    known = costs.filter((c) => c.costUsd !== null),
    cut = costs.length >= RUN_ATTEMPT_CLI_COST_READ_LIMIT;
  const partial =
    known.length !== costs.length ||
    cut ||
    data.completeness !== "complete" ||
    (data.gaps?.length ?? 0) > 0;
  const yes = (v: boolean | "unknown" | null | undefined) =>
    v == null || v === "unknown" ? "未知" : v ? "是" : "否";
  return [
    {
      label: "执行方式",
      value: execution
        ? `${execution.mode === "warm" ? "热（复用常驻进程）" : "冷（新启动常驻进程）"} · 迟到帧 ${execution.lateFrameCount}`
        : "未知（按轮进程或无记录）",
    },
    {
      label: "会话恢复耗时",
      value: measured == null ? "未知" : `${measured} ms`,
    },
    {
      label: "final 收尾",
      value: final
        ? `已请求 ${yes(final.requested)} · 已接受 ${yes(final.accepted)} · 已终止 ${yes(final.terminal)} · 抢占后续生成 ${yes(final.preemptedFollowUp)}`
        : final === null
          ? "本轮没有 final 回复"
          : "未知",
    },
    {
      label: "CLI 费用",
      value: known.length
        ? `$${known.reduce((sum, c) => sum + c.costUsd!, 0).toFixed(6)}（${partial ? "部分，整轮费用未知；" : ""}CLI 自报${cut ? "；记录已截断" : ""}）`
        : "未知（CLI 未报告可归属费用）",
    },
    {
      label: "进程清扫",
      value: data.processCleanups?.length
        ? data.processCleanups
            .map(
              (c) =>
                `${c.trigger}：发现 ${c.foundCount}，终止 ${c.killedCount}，剩余 ${c.remainingCount}，无法确认 ${c.unknownCount}${c.blocking ? "（阻塞新运行）" : ""}${c.error ? `；${c.error}` : ""}`,
            )
            .join("\n")
        : "无记录",
    },
  ];
}
