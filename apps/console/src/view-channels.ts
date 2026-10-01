import { WriteIntentSlot, parseAttachedDirectoryLines } from "./actions.ts";
import { roomSession } from "./api.ts";
import { subscribe, type ConsoleContext } from "./context.ts";
import { button, el, field, labelled, setStatus } from "./dom.ts";
import {
  INTENT_BUSY_UNKNOWN,
  intentControls,
  reportOutcome,
} from "./intent-view.ts";
import { summarizeChannels, type ChannelSummary } from "./model.ts";

function channelDirectories(summary: ChannelSummary): HTMLElement {
  return summary.legacyPrivateCwd
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
      ]);
}

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
      channelDirectories(summary),
    ],
  );
}

const PRIMARY_WATCH_MS = 2_000;
const PRIMARY_WATCH_LIMIT = 15;

function createChannelForm(context: ConsoleContext): {
  dispose: () => void;
  element: HTMLElement;
  refresh: () => void;
} {
  let watch: ReturnType<typeof setInterval> | undefined;
  const slot = new WriteIntentSlot();
  const name = el("input", {
    attrs: { autocomplete: "off", id: "create-channel-name", required: "" },
  });
  const slug = el("input", {
    attrs: { autocomplete: "off", id: "create-channel-slug", required: "" },
  });
  const autonomous = el("input", {
    attrs: { id: "create-channel-autonomous-tasks", type: "checkbox" },
  });
  const directories = el("textarea", {
    attrs: {
      id: "create-channel-directories",
      placeholder: "/Users/you/project",
      rows: "3",
    },
  });
  const status = el("p", {
    attrs: { id: "create-channel-status", role: "status" },
    className: "action-status",
  });
  const created = el("div", { attrs: { id: "create-channel-result" } });
  let createdRoomId: string | undefined;

  const renderCreated = () => {
    if (createdRoomId === undefined) return;
    const summary = summarizeChannels(context.rooms).find(
      ({ roomId }) => roomId === createdRoomId,
    );
    created.replaceChildren(
      summary === undefined
        ? el("p", { className: "muted", text: "已创建，等待频道列表刷新…" })
        : el("div", { className: "created-channel" }, [
            el("a", {
              attrs: {
                href: `#/channel/${encodeURIComponent(summary.roomId)}`,
              },
              className: "channel-name",
              text: `打开 #${summary.name}`,
            }),
            channelDirectories(summary),
          ]),
    );
  };

  const submit = el("button", {
    attrs: { id: "create-channel-submit", type: "submit" },
    text: "创建频道",
  });
  // The submitted fields are frozen in the intent; while it is pending or
  // unknown the inputs are disabled so the form always shows what was sent.
  slot.onChange((state) => {
    submit.disabled = state !== "idle";
    submit.textContent = state === "pending" ? "创建中…" : "创建频道";
    for (const input of [name, slug, directories, autonomous]) {
      input.disabled = state !== "idle";
    }
  });
  const form = el("form", { attrs: { id: "create-channel-form" } }, [
    labelled("名称", name),
    labelled("允许实例自主创建任务（默认关闭）", autonomous),
    labelled("slug", slug, "频道的稳定短名，创建后不可改"),
    labelled(
      "附加目录（每行一个绝对路径，可留空）",
      directories,
      "创建后不可改；平台只校验，不创建或删除这些目录",
    ),
    el("div", { className: "form-actions" }, [submit]),
    status,
    intentControls(slot, "create-channel", status),
    created,
  ]);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (slot.state === "unknown") {
      setStatus(status, "error", INTENT_BUSY_UNKNOWN);
      return;
    }
    if (slot.state === "pending") return;
    const identity = context.identity;
    if (identity === undefined) {
      setStatus(status, "error", "尚未连接，无法创建");
      return;
    }
    if (name.value.trim() === "" || slug.value.trim() === "") {
      setStatus(status, "error", "名称和 slug 不能为空");
      return;
    }
    const attached = parseAttachedDirectoryLines(directories.value);
    if (!attached.ok) {
      setStatus(status, "error", attached.error);
      return;
    }
    const submitted = [name.value, slug.value, directories.value] as const;
    setStatus(status, "info", "提交中…");
    void slot
      .submit({
        action: "channel-create",
        payload: {
          additionalDirectories: attached.value,
          allowInstanceTaskCreation: autonomous.checked,
          name: name.value.trim(),
          slug: slug.value.trim(),
          workspaceId: identity.workspaceId,
        },
        session: roomSession(context.client, identity.controlRoomId),
        send: (payload, basedOnControlRoomSeq, idempotencyKey) =>
          context.client.request("room.create", {
            ...(payload.additionalDirectories.length === 0
              ? {}
              : { additionalDirectories: [...payload.additionalDirectories] }),
            basedOnControlRoomSeq,
            idempotencyKey,
            kind: "channel",
            allowInstanceTaskCreation: payload.allowInstanceTaskCreation,
            name: payload.name,
            slug: payload.slug,
            workspaceId: payload.workspaceId,
          }),
        onSettled: (outcome) =>
          reportOutcome(status, outcome, "创建失败", (result) => {
            createdRoomId = result.room.roomId;
            setStatus(
              status,
              "ok",
              `已创建 #${result.room.name}${result.deduplicated ? "（重复提交，已去重）" : ""}`,
            );
            // Clears only a form still showing exactly what was sent.
            if (
              name.value === submitted[0] &&
              slug.value === submitted[1] &&
              directories.value === submitted[2]
            ) {
              name.value = "";
              slug.value = "";
              directories.value = "";
            }
            renderCreated();
            context.refreshRooms();
            // The Host reports the primary directory shortly after creation;
            // re-read the list until it leaves `pending` (bounded).
            clearInterval(watch);
            let reads = 0;
            watch = setInterval(() => {
              reads += 1;
              const state = context.rooms.find(
                ({ roomId }) => roomId === createdRoomId,
              )?.channelWorkspace?.primary?.state;
              if (
                (state !== undefined && state !== "pending") ||
                reads > PRIMARY_WATCH_LIMIT
              ) {
                clearInterval(watch);
                return;
              }
              context.refreshRooms();
            }, PRIMARY_WATCH_MS);
          }),
      })
      .catch(() => undefined);
  });
  return {
    dispose: () => clearInterval(watch),
    element: el("section", { className: "panel" }, [
      el("h2", { text: "创建频道" }),
      form,
    ]),
    refresh: renderCreated,
  };
}

export function mountChannelList(
  container: HTMLElement,
  context: ConsoleContext,
): () => void {
  const list = el("section", { className: "panel" });
  const create = createChannelForm(context);
  container.replaceChildren(create.element, list);
  const render = () => {
    const summaries = summarizeChannels(context.rooms);
    list.replaceChildren(
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
      button("刷新", () => context.refreshRooms(), {
        attrs: { id: "channel-list-refresh" },
        className: "secondary",
      }),
    );
    create.refresh();
  };
  render();
  const unsubscribe = subscribe(context, render);
  return () => {
    unsubscribe();
    create.dispose();
  };
}
