import { errorText, isAbort } from "./api.ts";
import type { ConsoleContext } from "./context.ts";
import { el, field } from "./dom.ts";
import { settingsRows } from "./model.ts";
import { Poller } from "./poll.ts";

const LIST_POLL_MS = 15_000;

export function mountSettings(
  container: HTMLElement,
  context: ConsoleContext,
): () => void {
  const body = el("div", { attrs: { id: "runtime-settings" } }, [
    el("p", { className: "muted", text: "加载中…" }),
  ]);
  container.replaceChildren(
    el("section", { className: "panel" }, [
      el("h2", { text: "运行设置（只读）" }),
      body,
    ]),
  );
  const poller = new Poller(LIST_POLL_MS, async (signal) => {
    try {
      const settings = await context.client.request(
        "runtime.settings.read",
        {},
        { signal },
      );
      if (signal.aborted) return;
      body.replaceChildren(
        ...settingsRows(settings).map(({ label, value }) =>
          field(label, value),
        ),
      );
    } catch (error) {
      if (signal.aborted || isAbort(error)) return;
      body.replaceChildren(
        el("p", {
          className: "error",
          text: `运行设置读取失败：${errorText(error)}`,
        }),
      );
    }
  });
  poller.start();
  return () => poller.stop();
}
