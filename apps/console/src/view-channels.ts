import { subscribe, type ConsoleContext } from "./context.ts";
import { el, field } from "./dom.ts";
import { summarizeChannels, type ChannelSummary } from "./model.ts";

function channelCard(summary: ChannelSummary): HTMLElement {
  return el(
    "li",
    {
      attrs: { "data-room-id": summary.roomId },
      className: `channel-card${summary.legacyPrivateCwd ? " is-legacy" : ""}`,
    },
    [
      el("a", {
        attrs: { href: `#/channel/${encodeURIComponent(summary.roomId)}` },
        className: "channel-name",
        text: `#${summary.name}`,
      }),
      summary.legacyPrivateCwd
        ? field("工作目录", "实例使用私有 cwd", "legacy-note")
        : el("div", { className: "channel-dirs" }, [
            field(
              "主目录",
              summary.primaryDirectory ?? "未记录",
              "primary-directory",
            ),
            field("主目录状态", summary.primaryLabel, "primary-state"),
            field(
              "附加目录",
              summary.attachedDirectories.length === 0
                ? "无"
                : summary.attachedDirectories.join("\n"),
              "attached-directories",
            ),
          ]),
    ],
  );
}

export function mountChannelList(
  container: HTMLElement,
  context: ConsoleContext,
): () => void {
  const render = () => {
    const summaries = summarizeChannels(context.rooms);
    container.replaceChildren(
      el("section", { className: "panel" }, [
        el("h2", { text: "频道" }),
        !context.roomsLoaded
          ? el("p", { className: "muted", text: "加载中…" })
          : summaries.length === 0
            ? el("p", { className: "muted", text: "没有未归档的频道" })
            : el(
                "ul",
                { attrs: { id: "channel-list" }, className: "channel-list" },
                summaries.map(channelCard),
              ),
      ]),
    );
  };
  render();
  return subscribe(context, render);
}
