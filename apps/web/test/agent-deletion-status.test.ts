import assert from "node:assert/strict";
import test from "node:test";
import type { AgentDeletionDiagnostics } from "@rah-os/protocol";
import { agentDeletionNotice } from "../src/agent-deletion-notice.ts";

const blocked: AgentDeletionDiagnostics = {
  agentDefinitionId: "agent_definition_1",
  blocker: {
    activationId: "activation_1",
    hostId: "mac-mini",
    kind: "run_attempt",
    predicate: "state IN ('starting','running','orphaned')",
    recoveryDriver: "generic-process",
    runAttemptId: "run_1",
    runAttemptState: "orphaned",
    runtimeProcessState: "orphaned",
    table: "run_attempts",
  },
  firstObservedAt: "2026-09-16T10:00:00.000Z",
  observedAt: "2026-09-16T10:05:00.000Z",
  participantId: "principal_1",
  reasonCode: "missing_runtime_termination_proof",
  recoverySteps: [
    "让 Host “mac-mini” 重新上线并保持心跳。",
    "不提供强制删除。",
  ],
  requestedAt: "2026-09-16T09:59:00.000Z",
  status: "blocked",
  summary: "缺终止证明，不能完成删除。",
};

test("a blocked deletion renders the blocking row, recovery identity and steps", () => {
  const notice = agentDeletionNotice(blocked)!;
  assert.ok(notice);
  assert.equal(notice.title, "缺终止证明，不能完成删除");
  const detail = notice.detail.join("\n");
  assert.match(detail, /run_attempts/);
  assert.match(detail, /run_1（orphaned）/);
  assert.match(detail, /Host：mac-mini/);
  assert.match(detail, /恢复驱动：generic-process/);
  assert.match(detail, /首次观察到阻塞：2026-09-16T10:00:00\.000Z/);
  assert.match(detail, /最近一次核对：2026-09-16T10:05:00\.000Z/);
  assert.deepEqual(notice.steps, blocked.recoverySteps);
  // The wait is a client deadline, never a deletion outcome or a force path.
  assert.ok(!/超时|强制删除该 Agent/.test(detail));
});

test("pending, completed and not-requested states never claim a block", () => {
  assert.equal(agentDeletionNotice(undefined), undefined);
  assert.equal(
    agentDeletionNotice({
      ...blocked,
      blocker: undefined,
      recoverySteps: [],
      status: "not_requested",
    }),
    undefined,
  );
  assert.equal(
    agentDeletionNotice({
      ...blocked,
      blocker: undefined,
      recoverySteps: [],
      status: "completed",
    }),
    undefined,
  );
  const pending = agentDeletionNotice({
    ...blocked,
    blocker: undefined,
    recoverySteps: [],
    status: "pending",
  })!;
  assert.equal(pending.title, "删除进行中");
  assert.deepEqual(pending.steps, []);
  assert.match(pending.detail.join("\n"), /无需重新提交/);
});
