/**
 * RunAttempt drill-down (`agent.run.usage.get`), shared by the Channel and
 * private-box pages. Diagnostics only: it never decides business state.
 * Throwaway: deleted in phase 4.
 */
import { errorText } from "./api.ts";
import type { ConsoleContext } from "./context.ts";
import { button, el, field, localTime } from "./dom.ts";
import { runUsageDetail, type RunAttemptEntry } from "./model.ts";

export type RunDetailPanel = {
  element: HTMLElement;
  show: (agentId: string, runAttemptId: string, label: string) => void;
};

export function runDetailPanel(context: ConsoleContext): RunDetailPanel {
  const body = el("div", { attrs: { id: "run-detail-body" } }, [
    el("p", {
      className: "muted",
      text: "在实例卡片的“最近运行”中选择一次运行查看详情",
    }),
  ]);
  const element = el(
    "section",
    { attrs: { id: "run-detail" }, className: "panel" },
    [el("h2", { text: "运行详情（RunAttempt）" }), body],
  );
  let request = 0;
  const show = (agentId: string, runAttemptId: string, label: string) => {
    request += 1;
    const current = request;
    body.replaceChildren(el("p", { className: "muted", text: "读取中…" }));
    void context.client
      .request("agent.run.usage.get", { agentId, runAttemptId })
      .then((response) => {
        if (current !== request) return;
        const detail = runUsageDetail(response);
        body.replaceChildren(
          el("p", {
            attrs: { "data-run-attempt-id": runAttemptId },
            className: "run-detail-title",
            text: `${label} · ${runAttemptId}`,
          }),
          el(
            "div",
            { className: "run-rows" },
            detail.rows.map(({ label: name, value }) => {
              const row = field(name, value, "run-row");
              row.setAttribute("data-field", name);
              return row;
            }),
          ),
          el("div", { className: "field" }, [
            el("span", { className: "field-label", text: "采集缺口" }),
            detail.gaps.length === 0
              ? el("span", { className: "field-value", text: "无" })
              : el(
                  "ul",
                  { className: "run-gaps" },
                  detail.gaps.map((gap) => el("li", { text: gap })),
                ),
          ]),
          el("div", { className: "field" }, [
            el("span", { className: "field-label", text: "进程清扫" }),
            detail.processCleanups.length === 0
              ? el("span", { className: "field-value", text: "无记录" })
              : el(
                  "ul",
                  { className: "run-cleanups" },
                  detail.processCleanups.map((cleanup) =>
                    el("li", { text: cleanup }),
                  ),
                ),
          ]),
          el("div", { className: "field" }, [
            el("span", {
              className: "field-label",
              text: `逐次生成${detail.truncated ? "（已截断，合计仍覆盖全部）" : ""}`,
            }),
            detail.generations.length === 0
              ? el("span", { className: "field-value", text: "无记录" })
              : el(
                  "ol",
                  { className: "run-generations" },
                  detail.generations.map((generation) =>
                    el("li", {
                      attrs: { "data-response-id": generation.responseId },
                      text: `${localTime(generation.observedAt)} · ${generation.provider} · 输入 ${generation.inputTokens}（缓存 ${generation.cachedInputTokens}）· 输出 ${generation.outputTokens}（推理 ${generation.reasoningOutputTokens}）· 上下文 ${generation.context}`,
                    }),
                  ),
                ),
          ]),
        );
      })
      .catch((error: unknown) => {
        if (current !== request) return;
        body.replaceChildren(
          el("p", {
            className: "error",
            text: `运行详情读取失败：${errorText(error)}`,
          }),
        );
      });
  };
  return { element, show };
}

/** The "recent runs" list inside an instance card. */
export function runList(
  runs: readonly RunAttemptEntry[],
  onSelect: (run: RunAttemptEntry) => void,
): HTMLElement {
  return el("div", { className: "field instance-runs" }, [
    el("span", { className: "field-label", text: "最近运行（本 Room）" }),
    runs.length === 0
      ? el("span", { className: "field-value muted", text: "无" })
      : el(
          "ul",
          { className: "run-list" },
          runs.map((run) =>
            el("li", {}, [
              button(
                `${localTime(run.updatedAt)} · ${run.lastEventType}`,
                () => onSelect(run),
                {
                  attrs: { "data-run-attempt-id": run.runAttemptId },
                  className: "secondary run-open",
                },
              ),
            ]),
          ),
        ),
  ]);
}
