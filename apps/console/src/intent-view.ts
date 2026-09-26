/**
 * Shared presentation of a WriteIntentSlot: an unknown result offers only
 * "verify/retry the original operation" (same key and payload) or "abandon".
 * Throwaway: deleted in phase 4.
 */
import { RahClientError } from "@rah-os/client-sdk";

import type { IntentOutcome, WriteIntentSlot } from "./actions.ts";
import { errorText } from "./api.ts";
import { button, el, setStatus } from "./dom.ts";

export const INTENT_BUSY_UNKNOWN =
  "上一次操作结果未知：请先“核实/重试原操作”或“放弃”，再提交新的操作";

export const LEAVE_WITH_UNRESOLVED_INTENT =
  "本页有尚未完成或结果未知的操作。离开后将丢失它的幂等键，无法再核实；之后重新提交可能重复执行。确定离开？";

/** Raw request detail; never "refresh the page", which would drop the key. */
function requestDetail(error: unknown): string {
  if (error instanceof RahClientError) {
    return `${error.message}（${error.code}，HTTP ${String(error.status)}）`;
  }
  return error instanceof Error ? error.message : String(error);
}

function verificationHint(error: unknown): string {
  if (!(error instanceof RahClientError)) return "";
  if (error.status === 401) {
    return "本地会话已更新或失效（同源请求通常已自动续期）。";
  }
  if (error.status === 403 || error.status === 404) {
    return "权限、成员关系或对象状态已变化；鉴权层或权限检查会先于幂等重放拒绝，不能证明原请求未执行。恢复权限后可再核实。";
  }
  if (error.status === 429) return "请求被限流，请稍后再核实。";
  if (error.code === "stale_context") {
    return "该操作未确认“先幂等重放、后新鲜度检查”，过期拒绝不能证明原请求未执行。";
  }
  if (error.status === 409) return "幂等冲突不能证明原请求的结果。";
  return "";
}

export function unknownText(
  error: unknown,
  verificationFailed = false,
): string {
  if (verificationFailed) {
    return `本次核实未成功：${requestDetail(error)}。${verificationHint(error)}原操作结果仍未知：已保留原幂等键、原请求与原基准序号，不会换键重发；恢复后可再“核实/重试原操作”，或选择“放弃”。请勿刷新页面，刷新会丢失原幂等键。`;
  }
  return `结果未知：${requestDetail(error)}。服务端可能已经执行；“核实/重试原操作”会用同一幂等键重发原请求，已执行的不会重复执行。请勿刷新页面，刷新会丢失原幂等键。`;
}

/**
 * Reports a settled outcome on `status`: success via `ok`, an explicit refusal
 * with `refusedLabel`, an unknown result with the retry guidance.
 */
export function reportOutcome<Result>(
  status: HTMLElement,
  outcome: IntentOutcome<Result>,
  refusedLabel: string,
  ok: (result: Result) => void,
): void {
  if (outcome.kind === "ok") ok(outcome.result);
  else if (outcome.kind === "rejected") {
    setStatus(status, "error", `${refusedLabel}：${errorText(outcome.error)}`);
  } else if (outcome.kind === "unknown") {
    setStatus(
      status,
      "error",
      unknownText(outcome.error, outcome.verificationFailed),
    );
  } else if (outcome.state === "unknown") {
    setStatus(status, "error", INTENT_BUSY_UNKNOWN);
  }
}

/** Retry/abandon controls, shown only while the slot's result is unknown. */
export function intentControls(
  slot: WriteIntentSlot,
  idPrefix: string,
  status: HTMLElement,
): HTMLElement {
  const retry = button(
    "核实/重试原操作",
    () => void slot.retry().catch(() => undefined),
    { attrs: { id: `${idPrefix}-retry` }, className: "intent-retry" },
  );
  const abandon = button(
    "放弃（不再核实）",
    () => {
      if (slot.abandon()) {
        setStatus(
          status,
          "info",
          "已放弃核实；该操作可能已经执行，请以页面刷新后的实际状态为准",
        );
      }
    },
    {
      attrs: { id: `${idPrefix}-abandon` },
      className: "secondary intent-abandon",
    },
  );
  const box = el(
    "div",
    { attrs: { id: `${idPrefix}-unknown` }, className: "intent-unknown" },
    [el("div", { className: "form-actions" }, [retry, abandon])],
  );
  // Visible while unknown and during a retry of it; hidden otherwise.
  let previous = slot.state;
  const render = (state: WriteIntentSlot["state"]) => {
    const retrying = state === "pending" && previous === "unknown";
    box.hidden = state !== "unknown" && !retrying;
    retry.disabled = state !== "unknown";
    abandon.disabled = state !== "unknown";
    previous = state;
  };
  render(slot.state);
  slot.onChange(render);
  return box;
}
