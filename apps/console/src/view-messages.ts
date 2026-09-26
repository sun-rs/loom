/**
 * One Room's message window and composer, shared by the Channel page and the
 * private-box page. Each view reads only its own Room: a Channel page never
 * loads private-box messages. Throwaway: deleted in phase 4.
 */
import {
  WriteIntentSlot,
  buildMessagePost,
  composerKeyAction,
  type MentionTarget,
} from "./actions.ts";
import { errorText, isAbort, roomSession } from "./api.ts";
import type { ConsoleContext } from "./context.ts";
import { el, labelled, localTime, setStatus } from "./dom.ts";
import {
  INTENT_BUSY_UNKNOWN,
  intentControls,
  reportOutcome,
} from "./intent-view.ts";
import {
  loadLatestMessages,
  loadNewerMessages,
  type MessageWindow,
} from "./model.ts";

export type MessagePanel = {
  element: HTMLElement;
  /** Loads the first window, then increments after its cursor. */
  refresh: (signal: AbortSignal) => Promise<void>;
  /** Re-renders the window (author labels may have changed). */
  render: () => void;
  window: () => MessageWindow | undefined;
};

export function messagePanel(input: {
  actorLabel: (actorId: string) => string;
  context: ConsoleContext;
  heading: string;
  /** Present on a Channel: the instances a message may @. */
  mention?: HTMLSelectElement;
  mentionTarget?: () => MentionTarget | undefined;
  onRendered?: (window: MessageWindow) => void;
  pollNow: () => void;
  roomId: string;
}): MessagePanel {
  const { context, roomId } = input;
  let messageWindow: MessageWindow | undefined;
  const list = el("ol", {
    attrs: { id: "message-list" },
    className: "message-list",
  });
  const status = el("p", { className: "muted", text: "加载中…" });

  const slot = new WriteIntentSlot();
  const composer = el("textarea", {
    attrs: {
      id: "composer-input",
      placeholder: "发消息（Enter 发送，Shift+Enter 换行）",
      rows: "3",
    },
  });
  const send = el("button", {
    attrs: { id: "composer-send", type: "button" },
    text: "发送",
  });
  const composerStatus = el("p", {
    attrs: { id: "composer-status", role: "status" },
    className: "action-status",
  });
  const submit = () => {
    if (slot.state === "unknown") {
      setStatus(composerStatus, "error", INTENT_BUSY_UNKNOWN);
      return;
    }
    if (slot.state === "pending") return;
    if (context.identity === undefined) {
      setStatus(composerStatus, "error", "尚未连接，无法发送");
      return;
    }
    const post = buildMessagePost(composer.value, input.mentionTarget?.());
    if (!post.ok) {
      setStatus(composerStatus, "error", post.error);
      return;
    }
    // The draft keeps its own life: success clears it only if unchanged.
    const submitted = composer.value;
    setStatus(composerStatus, "info", "发送中…");
    void slot
      .submit({
        action: "message",
        payload: post.value,
        session: roomSession(context.client, roomId),
        send: (payload, basedOnRoomSeq, idempotencyKey) =>
          context.client.request("message.post", {
            basedOnRoomSeq,
            body: payload.body,
            idempotencyKey,
            recipients: payload.recipients.map((recipient) => ({
              ...recipient,
            })),
            roomId,
          }),
        onSettled: (outcome) =>
          reportOutcome(composerStatus, outcome, "发送被拒绝", (result) => {
            if (composer.value === submitted) composer.value = "";
            setStatus(
              composerStatus,
              "ok",
              result.deduplicated
                ? "已发送（重试核实：原请求已执行）"
                : "已发送",
            );
            input.pollNow();
          }),
      })
      .catch(() => undefined);
  };
  slot.onChange((state) => {
    send.disabled = state !== "idle";
    send.textContent = state === "pending" ? "发送中…" : "发送";
  });
  send.addEventListener("click", submit);
  composer.addEventListener("keydown", (event) => {
    if (composerKeyAction(event) !== "submit") return;
    // Keyboard and button share one intent slot: both are refused alike.
    event.preventDefault();
    submit();
  });

  const render = () => {
    if (messageWindow === undefined) return;
    const nearBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    status.textContent = messageWindow.messages.length === 0 ? "暂无消息" : "";
    list.replaceChildren(
      ...messageWindow.messages.map((message) =>
        el(
          "li",
          {
            attrs: {
              "data-actor-id": message.actorId,
              "data-room-seq": String(message.roomSeq),
            },
            className: `message${message.system ? " is-system" : ""}`,
          },
          [
            el("div", { className: "message-meta" }, [
              el("span", {
                className: "message-actor",
                text: input.actorLabel(message.actorId),
              }),
              el("span", {
                className: "muted",
                text: ` · #${String(message.roomSeq)} · ${localTime(message.createdAt)}`,
              }),
            ]),
            el("div", { className: "message-body", text: message.body }),
          ],
        ),
      ),
    );
    if (nearBottom) list.scrollTop = list.scrollHeight;
    input.onRendered?.(messageWindow);
  };

  const refresh = async (signal: AbortSignal) => {
    try {
      const next =
        messageWindow === undefined
          ? await loadLatestMessages(context.client, roomId, { signal })
          : await loadNewerMessages(context.client, roomId, messageWindow, {
              signal,
            });
      if (signal.aborted) return;
      messageWindow = next;
      render();
    } catch (error) {
      if (signal.aborted || isAbort(error)) return;
      status.textContent = `消息读取失败：${errorText(error)}`;
    }
  };

  const element = el("section", { className: "panel messages" }, [
    el("h2", { text: input.heading }),
    status,
    list,
    el("div", { className: "composer" }, [
      input.mention === undefined
        ? null
        : labelled("@ 实例（可选）", input.mention),
      composer,
      el("div", { className: "form-actions" }, [send]),
      composerStatus,
      intentControls(slot, "composer", composerStatus),
    ]),
  ]);
  return { element, refresh, render, window: () => messageWindow };
}
