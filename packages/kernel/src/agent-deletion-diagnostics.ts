import type { DatabaseSync } from "node:sqlite";
import type {
  AgentDeletionBlocker,
  AgentDeletionDiagnostics,
} from "@rah-os/protocol";
import { text } from "./sqlite-row.ts";

/**
 * R5 — Agent deletion block observability.
 *
 * The deletion fence in `finishAgentDeletion` refuses to tombstone an Agent
 * while any durable row still proves a live runtime lane. Those rows are the
 * only authority, so the diagnostic is derived from exactly the same
 * predicates, in the same order, rather than from a second bookkeeping store.
 *
 * The one fact that cannot be derived is *when* the block started: durable rows
 * carry their own timestamps, not the moment the deletion fence first refused.
 * That single fact lives in `agent_deletion_blocks`, written only when the
 * blocker identity changes and deleted when the block clears. No event is
 * appended per reconciliation tick.
 */

/** Evaluated in order; the first match is the reported blocker. */
export const AGENT_DELETION_BLOCKERS = [
  {
    kind: "run_attempt",
    predicate: "state IN ('starting','running','orphaned')",
    table: "run_attempts",
  },
  {
    kind: "runtime_process",
    predicate: "state <> 'terminated'",
    table: "runtime_processes",
  },
  { kind: "activation", predicate: "state = 'leased'", table: "activations" },
  {
    kind: "placement",
    predicate: "state IN ('reserved','consumed')",
    table: "placements",
  },
  {
    kind: "exclusive_operation_lease",
    predicate: "state = 'active'",
    table: "agent_exclusive_operation_leases",
  },
] as const satisfies ReadonlyArray<{
  kind: AgentDeletionBlocker["kind"];
  predicate: string;
  table: string;
}>;

function optionalText(row: Record<string, unknown>, column: string) {
  const value = row[column];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Returns the first durable row that blocks deletion, with the run/host/driver
 * identity an operator needs to bring the right Host back. Only identifiers and
 * enumerated states are read; recovery descriptors and error text stay out.
 */
export function findAgentDeletionBlocker(
  database: DatabaseSync,
  participantId: string,
): AgentDeletionBlocker | undefined {
  for (const blocker of AGENT_DELETION_BLOCKERS) {
    const row = database
      .prepare(
        `SELECT * FROM ${blocker.table} WHERE participant_id=? AND ${blocker.predicate} LIMIT 1`,
      )
      .get(participantId) as Record<string, unknown> | undefined;
    if (!row) continue;
    const runAttemptId =
      optionalText(row, "run_attempt_id") ??
      (blocker.table === "run_attempts"
        ? optionalText(row, "run_attempt_id")
        : undefined);
    const runtime = runAttemptId
      ? (database
          .prepare(
            "SELECT launch_host_id, recovery_driver, state FROM runtime_processes WHERE run_attempt_id=?",
          )
          .get(runAttemptId) as Record<string, unknown> | undefined)
      : undefined;
    const attempt =
      blocker.table === "run_attempts"
        ? row
        : runAttemptId
          ? ((database
              .prepare(
                "SELECT host_id, state, activation_id FROM run_attempts WHERE run_attempt_id=?",
              )
              .get(runAttemptId) ?? undefined) as
              Record<string, unknown> | undefined)
          : undefined;
    const hostId =
      optionalText(row, "host_id") ??
      optionalText(row, "launch_host_id") ??
      (attempt ? optionalText(attempt, "host_id") : undefined) ??
      (runtime ? optionalText(runtime, "launch_host_id") : undefined);
    const activationId =
      optionalText(row, "activation_id") ??
      (attempt ? optionalText(attempt, "activation_id") : undefined);
    const recoveryDriver =
      optionalText(row, "recovery_driver") ??
      (runtime ? optionalText(runtime, "recovery_driver") : undefined);
    const runAttemptState = attempt
      ? optionalText(attempt, "state")
      : undefined;
    const runtimeProcessState =
      blocker.table === "runtime_processes"
        ? optionalText(row, "state")
        : runtime
          ? optionalText(runtime, "state")
          : undefined;
    return {
      kind: blocker.kind,
      predicate: blocker.predicate,
      table: blocker.table,
      ...(activationId === undefined ? {} : { activationId }),
      ...(hostId === undefined ? {} : { hostId }),
      ...(recoveryDriver === undefined ? {} : { recoveryDriver }),
      ...(runAttemptId === undefined ? {} : { runAttemptId }),
      ...(runAttemptState === undefined ? {} : { runAttemptState }),
      ...(runtimeProcessState === undefined ? {} : { runtimeProcessState }),
    };
  }
  return undefined;
}

/** Stable identity of a blocker; a change here is a reportable state change. */
export function agentDeletionBlockerSignature(
  blocker: AgentDeletionBlocker,
): string {
  return [
    blocker.kind,
    blocker.runAttemptId ?? "-",
    blocker.activationId ?? "-",
    blocker.hostId ?? "-",
    blocker.recoveryDriver ?? "-",
    blocker.runAttemptState ?? "-",
    blocker.runtimeProcessState ?? "-",
  ].join("|");
}

const BLOCKER_SUBJECT: Record<AgentDeletionBlocker["kind"], string> = {
  activation: "一个仍处于 leased 的 Activation",
  exclusive_operation_lease: "一个仍然有效的 Agent 独占操作租约",
  placement: "一个仍被预留或占用的 Placement",
  run_attempt: "一次仍未终止的 RunAttempt",
  runtime_process: "一个仍未登记终止的 Runtime 进程",
};

export function describeAgentDeletionBlocker(blocker: AgentDeletionBlocker): {
  recoverySteps: string[];
  summary: string;
} {
  const host = blocker.hostId ?? "未知 Host";
  const driver = blocker.recoveryDriver;
  // Runtime termination already proven, RunAttempt bookkeeping still orphaned:
  // the operator must not be told to bring a Host back that has already done
  // its part. This is a distinct, separately actionable state.
  const provenButOrphaned =
    blocker.kind === "run_attempt" &&
    blocker.runAttemptState === "orphaned" &&
    blocker.runtimeProcessState === "terminated";
  if (provenButOrphaned)
    return {
      recoverySteps: [
        `Runtime 进程的终止已由恢复所有者证明（runtime_processes 已 terminated），剩余阻塞只是 RunAttempt ${blocker.runAttemptId ?? "未知"} 仍停留在 orphaned。`,
        "这属于 RunAttempt 生命周期所有者的缺口：当前没有把已证明的终止回写为 RunAttempt 终态的路径，删除会一直等待。",
        "请把该缺口报告给 RunAttempt 生命周期所有者处理；不要手工改库，也不提供绕过终止证明的强制删除。",
        "修复后无需重新提交删除：持久的删除意图会自动完成。",
      ],
      summary: `缺终止证明，不能完成删除：RunAttempt 仍记录为 orphaned（${blocker.table}），尽管 Runtime 进程终止已被证明。`,
    };
  const steps = [
    `让 Host “${host}” 重新上线并保持心跳；它是唯一能提交该运行终止证明的身份。`,
    ...(driver === undefined
      ? []
      : [
          `确认该 Host 装载了 recovery driver “${driver}”，恢复所有者会据此认领并登记终止。`,
        ]),
    ...(blocker.runAttemptId === undefined
      ? []
      : [
          `用现有 runtime recovery 入口处理 RunAttempt ${blocker.runAttemptId}，由它写入真实退出结果。`,
        ]),
    "终止证明写入后无需重新提交删除：持久的删除意图会自动完成。",
    "不提供绕过终止证明的强制删除；在证明到达前 Agent 保持停用，历史与私有记忆不会被删除。",
  ];
  return {
    recoverySteps: steps,
    summary: `缺终止证明，不能完成删除：${BLOCKER_SUBJECT[blocker.kind]}仍记录在 ${blocker.table}（${blocker.predicate}）。`,
  };
}

/** One reportable change of the block state; emitted at most once per change. */
export type AgentDeletionBlockChange =
  | {
      agentId: string;
      blocker: AgentDeletionBlocker;
      kind: "blocked";
      summary: string;
    }
  | { agentId: string; kind: "cleared" };

export type AgentDeletionBlockRecord = {
  firstObservedAt: string;
  signature: string;
};

export function readAgentDeletionBlockRecord(
  database: DatabaseSync,
  agentId: string,
): AgentDeletionBlockRecord | undefined {
  const row = database
    .prepare(
      "SELECT blocker_signature, first_observed_at FROM agent_deletion_blocks WHERE agent_definition_id=?",
    )
    .get(agentId);
  if (!row) return undefined;
  return {
    firstObservedAt: text(row, "first_observed_at"),
    signature: text(row, "blocker_signature"),
  };
}

/**
 * State change only: the row is written when the block opens or the blocker
 * identity changes, never once per tick. `first_observed_at` is preserved
 * across blocker changes so an operator sees how long the intent has waited.
 */
export function recordAgentDeletionBlock(
  database: DatabaseSync,
  input: {
    agentId: string;
    blocker: AgentDeletionBlocker;
    now: string;
    participantId: string;
  },
): boolean {
  const signature = agentDeletionBlockerSignature(input.blocker);
  const existing = readAgentDeletionBlockRecord(database, input.agentId);
  if (existing?.signature === signature) return false;
  if (existing) {
    database
      .prepare(
        "UPDATE agent_deletion_blocks SET blocker_signature=?, participant_id=?, recorded_at=? WHERE agent_definition_id=?",
      )
      .run(signature, input.participantId, input.now, input.agentId);
    return true;
  }
  database
    .prepare(
      "INSERT INTO agent_deletion_blocks (agent_definition_id, participant_id, blocker_signature, first_observed_at, recorded_at) VALUES (?,?,?,?,?)",
    )
    .run(input.agentId, input.participantId, signature, input.now, input.now);
  return true;
}

/** Returns true when an observation row existed and was cleared. */
export function clearAgentDeletionBlock(
  database: DatabaseSync,
  agentId: string,
): boolean {
  if (!readAgentDeletionBlockRecord(database, agentId)) return false;
  database
    .prepare("DELETE FROM agent_deletion_blocks WHERE agent_definition_id=?")
    .run(agentId);
  return true;
}

/**
 * Derives the full read-only diagnostic. The durable deletion request and the
 * live blocker predicates are re-evaluated on every read, so `observedAt` is
 * the read itself and no staleness can accumulate.
 */
export function readAgentDeletionDiagnostics(
  database: DatabaseSync,
  input: {
    agentId: string;
    now: string;
    participantId: string;
    state: string;
  },
): AgentDeletionDiagnostics {
  const base = {
    agentId: input.agentId,
    observedAt: input.now,
    participantId: input.participantId,
  };
  const requestRow = database
    .prepare(
      "SELECT created_at FROM room_events WHERE aggregate_id=? AND type='agent.deletion_requested' LIMIT 1",
    )
    .get(input.agentId);
  const requestedAt = requestRow ? text(requestRow, "created_at") : undefined;
  if (input.state === "tombstoned")
    return {
      ...base,
      ...(requestedAt === undefined ? {} : { requestedAt }),
      recoverySteps: [],
      status: "completed",
      summary: "该 Agent 已删除，删除意图已完成。",
    };
  if (requestedAt === undefined)
    return {
      ...base,
      recoverySteps: [],
      status: "not_requested",
      summary: "该 Agent 没有待处理的删除请求。",
    };
  const blocker = findAgentDeletionBlocker(database, input.participantId);
  if (!blocker)
    return {
      ...base,
      requestedAt,
      recoverySteps: ["无需操作：后台协调器会在下一次巡检中完成删除。"],
      status: "pending",
      summary: "删除意图已登记，没有阻塞的运行时行，正在等待后台协调器完成。",
    };
  const record = readAgentDeletionBlockRecord(database, input.agentId);
  const described = describeAgentDeletionBlocker(blocker);
  return {
    ...base,
    blocker,
    firstObservedAt: record?.firstObservedAt ?? requestedAt,
    reasonCode: "missing_runtime_termination_proof",
    recoverySteps: described.recoverySteps,
    requestedAt,
    status: "blocked",
    summary: described.summary,
  };
}
