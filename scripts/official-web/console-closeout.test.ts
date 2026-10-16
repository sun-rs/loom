import test from "node:test";
import assert from "node:assert/strict";
import {
  saveTaskPermission,
  summaryCells,
  diagnosticRows,
} from "../../frontends/raft/loom/console-closeout.ts";
import { WriteIntentSlot } from "@rah-os/client-core/write-intent";
test("task permission preserves shown channel metadata and basis on exact replay", async () => {
  const calls: any[] = [];
  let first = true;
  const writes = new WriteIntentSlot();
  const client: any = {
    request: async (op: any, p: any) => {
      calls.push([op, p]);
      if (first) {
        first = false;
        throw Error("lost");
      }
      return {};
    },
  };
  await saveTaskPermission(
    client,
    writes,
    {
      roomId: "r",
      name: "room",
      description: "keep",
      visibility: "private",
    } as any,
    17,
    true,
    () => {},
  );
  assert.equal(writes.state, "unknown");
  await writes.retry();
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][1].basedOnRoomSeq, 17);
  assert.equal(calls[0][1].description, "keep");
  writes.discard();
});
test("summary never treats an unreported run or cost as zero", () => {
  const row = summaryCells({
    runs: { total: 1, complete: 0, partial: 0, unavailable: 1 },
    tokens: {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: null,
    },
    cliEstimatedCost: { totalUsd: null, runsUnreported: 1 },
  } as any);
  assert.equal(row[1], "未知");
  assert.equal(row[5], "未知");
});
test("diagnostics distinguish absent execution and incomplete cost", () => {
  const rows = diagnosticRows({
    execution: null,
    sessionResumeMs: null,
    finalInterrupt: null,
    cliCosts: [],
    processCleanups: [],
  } as any);
  assert.match(rows.find((r) => r.label === "执行方式")!.value, /未知/);
  assert.match(rows.find((r) => r.label === "CLI 费用")!.value, /未知/);
});
test("known zero remains zero, partial totals and unknown final status remain explicit", () => {
  const figure: any = {
    runs: { total: 2, complete: 1, partial: 0, unavailable: 1 },
    tokens: {
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 2,
      reasoningOutputTokens: null,
    },
    cliEstimatedCost: { totalUsd: 0, runsUnreported: 1 },
  };
  assert.equal(summaryCells(figure)[2], "0（部分）");
  assert.match(summaryCells(figure)[5], /\$0\.000000（部分/);
  const rows = diagnosticRows({
    execution: { mode: "warm", lateFrameCount: 2, sessionResumeMs: 12 },
    finalInterrupt: {
      requested: true,
      accepted: "unknown",
      terminal: false,
      preemptedFollowUp: "unknown",
    },
    cliCosts: [{ costUsd: 0 }, { costUsd: null }],
    completeness: "partial",
    gaps: [],
    processCleanups: [],
  } as any);
  assert.match(
    rows.find((r) => r.label === "final 收尾")!.value,
    /已接受 未知/,
  );
  assert.match(rows.find((r) => r.label === "CLI 费用")!.value, /整轮费用未知/);
  assert.equal(rows.find((r) => r.label === "会话恢复耗时")!.value, "12 ms");
});
