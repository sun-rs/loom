import { errorText, isAbort } from "./api.ts";
import type { ConsoleContext } from "./context.ts";
import { el, present } from "./dom.ts";
import { loadUsage, type UsageRow, type UsageWindow } from "./model.ts";
import { Poller } from "./poll.ts";

const LIST_POLL_MS = 15_000;
const COLUMNS: ReadonlyArray<[keyof UsageRow, string]> = [
  ["label", "实例"],
  ["runs", "运行数"],
  ["inputTokens", "输入 token"],
  ["cachedInputTokens", "缓存输入"],
  ["outputTokens", "输出 token"],
  ["reasoningTokens", "推理输出"],
  ["cost", "费用"],
];

function usageTable(rows: readonly UsageRow[], totals: UsageRow): HTMLElement {
  const row = (entry: UsageRow, className: string) =>
    el(
      "tr",
      { className },
      COLUMNS.map(([key]) => el("td", { text: entry[key] })),
    );
  return el("div", { className: "table-scroll" }, [
    el("table", { attrs: { id: "usage-table" }, className: "usage-table" }, [
      el("thead", {}, [
        el(
          "tr",
          {},
          COLUMNS.map(([, label]) => el("th", { text: label })),
        ),
      ]),
      el("tbody", {}, [
        ...rows.map((entry) => row(entry, "usage-row")),
        row(totals, "usage-total"),
      ]),
    ]),
  ]);
}

export function mountUsage(
  container: HTMLElement,
  context: ConsoleContext,
): () => void {
  let usageWindow: UsageWindow = "24h";
  const toggles = el("div", { className: "toggle-group" });
  const body = el("div", {}, [
    el("p", { className: "muted", text: "加载中…" }),
  ]);
  container.replaceChildren(
    el("section", { className: "panel" }, [
      el("h2", { text: "用量汇总（按实例，CLI 自报；未知不补零）" }),
      toggles,
      body,
    ]),
  );
  const poller = new Poller(LIST_POLL_MS, async (signal) => {
    try {
      const labels = new Map<string, string>();
      if (context.identity !== undefined) {
        const roles = await context.client.request(
          "role.list",
          { controlRoomId: context.identity.controlRoomId },
          { signal },
        );
        const roleNames = new Map(
          roles.roles.map((role) => [
            role.roleId,
            role.configuration.displayName,
          ]),
        );
        for (const instance of roles.instances) {
          labels.set(
            instance.instanceId,
            `${roleNames.get(instance.roleId) ?? instance.roleId}（${instance.instanceId}）`,
          );
        }
      }
      const view = await loadUsage(
        context.client,
        { labels, now: new Date(), window: usageWindow },
        { signal },
      );
      if (signal.aborted) return;
      body.replaceChildren(
        ...present(
          view.truncated
            ? el("p", { className: "error", text: "分组过多，结果已截断" })
            : null,
          usageTable(view.rows, view.totals),
        ),
      );
    } catch (error) {
      if (signal.aborted || isAbort(error)) return;
      body.replaceChildren(
        el("p", {
          className: "error",
          text: `用量读取失败：${errorText(error)}`,
        }),
      );
    }
  });
  const renderToggles = () => {
    toggles.replaceChildren(
      ...(["24h", "7d"] as const).map((value) => {
        const button = el("button", {
          attrs: {
            "aria-pressed": String(value === usageWindow),
            type: "button",
          },
          text: value === "24h" ? "最近 24 小时" : "最近 7 天",
        });
        button.addEventListener("click", () => {
          usageWindow = value;
          renderToggles();
          poller.runNow();
        });
        return button;
      }),
    );
  };
  renderToggles();
  poller.start();
  return () => poller.stop();
}
