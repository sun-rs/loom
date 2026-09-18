import type { AgentDeletionDiagnostics } from "@rah-os/protocol";

/**
 * R5 — pure presentation logic for the Agent deletion block projection, kept in
 * a plain module so it is unit-testable without a JSX loader. The Kernel owns
 * why a deletion is blocked; this only shapes the dialog copy.
 */

export type AgentDeletionNotice = {
  detail: string[];
  steps: readonly string[];
  title: string;
};

/**
 * Turns the read-only projection into the dialog copy. The previous behaviour
 * surfaced a bare 30-second wait error with nothing actionable in it; the wait
 * is a client deadline, not a deletion outcome, so the copy says the request
 * stays durable and names the row that must terminate first.
 */
export function agentDeletionNotice(
  diagnostics: AgentDeletionDiagnostics | undefined,
): AgentDeletionNotice | undefined {
  if (diagnostics === undefined) return undefined;
  if (diagnostics.status === "pending")
    return {
      detail: [
        "删除请求已持久记录，后台协调器会在下一次巡检中完成，无需重新提交。",
      ],
      steps: [],
      title: "删除进行中",
    };
  if (diagnostics.status !== "blocked" || diagnostics.blocker === undefined)
    return undefined;
  const { blocker } = diagnostics;
  const detail = [
    `阻塞记录：${blocker.table}（${blocker.predicate}）`,
    ...(blocker.runAttemptId === undefined
      ? []
      : [
          `RunAttempt：${blocker.runAttemptId}${blocker.runAttemptState === undefined ? "" : `（${blocker.runAttemptState}）`}`,
        ]),
    ...(blocker.hostId === undefined ? [] : [`Host：${blocker.hostId}`]),
    ...(blocker.recoveryDriver === undefined
      ? []
      : [`恢复驱动：${blocker.recoveryDriver}`]),
    ...(diagnostics.firstObservedAt === undefined
      ? []
      : [`首次观察到阻塞：${diagnostics.firstObservedAt}`]),
    `最近一次核对：${diagnostics.observedAt}`,
  ];
  return {
    detail,
    steps: diagnostics.recoverySteps,
    title: "缺终止证明，不能完成删除",
  };
}
