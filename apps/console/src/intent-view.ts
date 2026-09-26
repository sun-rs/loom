/**
 * Shared presentation of a WriteIntentSlot: an unknown result offers only
 * "verify/retry the original operation" (same key and payload) or "abandon".
 * Throwaway: deleted in phase 4.
 */
import type { IntentOutcome, WriteIntentSlot } from "./actions.ts";
import { errorText } from "./api.ts";
import { button, el, setStatus } from "./dom.ts";

export const INTENT_BUSY_UNKNOWN =
  "上一次操作结果未知：请先“核实/重试原操作”或“放弃”，再提交新的操作";

export function unknownText(error: unknown): string {
  return `结果未知：${errorText(error)}。服务端可能已经执行；“核实/重试原操作”会用同一幂等键重发原请求，已执行的不会重复执行。`;
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
    setStatus(status, "error", unknownText(outcome.error));
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
