import type { RahClient } from "@rah-os/client-sdk";
import type { ClientRunAttemptUsageGetResponse } from "@rah-os/protocol";
export async function loadTrajectory(
  client: RahClient,
  input: {
    agentId: string;
    instanceId: string;
    roomId: string;
    beforeActivityId?: string;
  },
  signal?: AbortSignal,
) {
  const page = await client.request(
    "agent.trajectory.list",
    {
      agentId: input.agentId,
      limit: 50,
      ...(input.beforeActivityId
        ? { beforeActivityId: input.beforeActivityId }
        : {}),
    },
    { signal },
  );
  return {
    ...page,
    activities: page.activities
      .filter(
        (r) =>
          r.roomId === input.roomId && r.participantId === input.instanceId,
      )
      .sort((a, b) => a.serverSequence - b.serverSequence),
  };
}
/** Native measurements only. Aggregate reports are distinct, never added to generations. */
export function usageRows(data: ClientRunAttemptUsageGetResponse) {
  const count = (n: number | null | undefined) =>
    n == null ? "未知" : n.toLocaleString("zh-CN");
  const tokens = (n: number | null) =>
    n == null
      ? "未知"
      : count(n) + (data.completeness === "partial" ? "（部分）" : "");
  const context = [...data.generations]
    .reverse()
    .find((g) => g.contextUsedTokens !== null || g.contextWindow !== null);
  const aggregate = data.aggregateUsage;
  return [
    {
      label: "用量完整性",
      value: {
        complete: "完整",
        partial: "部分（有采集缺口）",
        unavailable: "无记录（未知）",
      }[data.completeness],
    },
    ...(
      [
        ["生成次数", "generations"],
        ["输入 token", "inputTokens"],
        ["缓存输入 token", "cachedInputTokens"],
        ["输出 token", "outputTokens"],
        ["推理 token", "reasoningOutputTokens"],
      ] as const
    ).map(([label, key]) => ({ label, value: tokens(data.totals[key]) })),
    {
      label: "上下文占用",
      value: context
        ? `${count(context.contextUsedTokens)} / ${count(context.contextWindow)}${data.truncated ? "（所列生成中的最后一次）" : ""}`
        : "未知",
    },
    { label: "本轮压缩次数", value: count(data.compactionCount) },
    ...(aggregate?.totals.entries
      ? [
          {
            label: "原生压缩汇总（独立口径）",
            value: `输入 ${count(aggregate.totals.inputTokens)} · 输出 ${count(aggregate.totals.outputTokens)}；不与逐次生成相加`,
          },
        ]
      : []),
  ];
}
