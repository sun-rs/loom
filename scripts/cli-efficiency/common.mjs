import assert from "node:assert/strict";
import { readFileSync, globSync } from "node:fs";
import { homedir } from "node:os";
import { summarizeUsage } from "./metrics.mjs";
export const model = "gpt-5.6-luna",
  effort = "low",
  bindingId = "local:codex-cli/v1:gpt-5.6-luna";
export const instructions =
  "Read-only bounded review of scripts/workbench-launch-receipt.mjs and scripts/workbench-launch-receipt.test.mjs only. Do not edit files, write memory, create tasks, run restart commands, install dependencies, or read other project files. Distinguish proven facts from conditional concerns.";
const baseQuestions = [
  "只读审查当前工作目录的 scripts/workbench-launch-receipt.mjs 和 scripts/workbench-launch-receipt.test.mjs（已提供的固定 Git 快照，无需 git 命令）。仅分析网络配置在重启时的保留，列出已保证的行为、至多两项有行号依据的条件性风险；不能从两份文件证明的明确列出，不强凑漏洞。不要读其他项目文件，不修改文件、记忆或创建任务。最多400中文字。",
  "继续上一轮：PID一致是否足以证明配置可信？区分函数级保证与整个重启流程的保证，纠正上一轮可能过强的结论，提出两条回归测试。只依赖已读内容，不重新读文件，不修改文件、记忆或创建任务。最多300中文字。",
  "继续此前审查：给出最终接受或拒绝修改的判断、保留和撤回的观点，以及前轮两条回归测试的验收标准。不要重新审查或读取文件，不修改文件、记忆或创建任务。最多300中文字。",
];
export const questions = baseQuestions.map(
  (q) =>
    q +
    " 请只发送一次最终回答，以“审查结论：”开头；不要单独发送收到或进度确认。",
);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function wait(fn, ms = 240000) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    assert.ok(Date.now() < end, "Gate timeout");
    await sleep(100);
  }
}
export function transcript(sessionId) {
  const paths = globSync(
    `${homedir()}/.codex/sessions/**/*${sessionId}*.jsonl`,
  );
  assert.equal(paths.length, 1, "Exactly one native transcript");
  return readFileSync(paths[0], "utf8").trim().split("\n").map(JSON.parse);
}
// usageOptions.replyAt splits generations at the effective Room reply (RAH arm);
// omitted for native, whose final answer generation is the reply.
export function measure(sessionId, round, usageOptions) {
  const events = transcript(sessionId).filter(
    (e) => e.timestamp >= round.startedAt && e.timestamp <= round.finishedAt,
  );
  const contexts = events.filter((e) => e.type === "turn_context");
  assert.equal(contexts.length, 1, "One native turn per human question");
  for (const e of contexts) {
    assert.equal(e.payload.model, model);
    assert.equal(e.payload.effort, effort);
  }
  return {
    ...summarizeUsage(events, usageOptions),
    replySeconds: round.replySeconds,
    toolCalls: events
      .filter((e) =>
        ["function_call", "custom_tool_call"].includes(e.payload?.type),
      )
      .map((e) => {
        const args = e.payload.arguments ?? e.payload.input ?? "";
        const kind = /message-post/.test(args)
          ? "box-post"
          : /message-check/.test(args)
            ? "box-check"
            : "other";
        // S2-a: whether the Worker call carried the per-turn handle flag
        // (boolean only; the handle itself is never recorded).
        return {
          at: e.timestamp,
          name: e.payload.name,
          kind,
          ...(kind === "other" ? {} : { turnHandle: /--turn\b/.test(args) }),
        };
      }),
  };
}
