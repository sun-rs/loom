/** Throwaway Task entry points; all authority and state remain in Kernel. */
import { WriteIntentSlot, composerKeyAction } from "./actions.ts";
import { errorText, roomSession } from "./api.ts";
import type { ConsoleContext } from "./context.ts";
import { button, el, labelled, setStatus } from "./dom.ts";
import { intentControls, reportOutcome } from "./intent-view.ts";
import { Poller } from "./poll.ts";

export function taskPanel(context: ConsoleContext, roomId: string) {
  const slot = new WriteIntentSlot();
  const status = el("p", { attrs: { role: "status" } });
  const policy = el("p", { attrs: { id: "task-policy" } });
  const list = el("div");
  let selectedThreadId: string | undefined;
  const threadHeading = el("h3", { text: "选择任务以查看消息列" });
  const threadMessages = el("div");
  const reply = el("textarea", {
    attrs: { id: "task-thread-reply", placeholder: "在任务消息列中回复" },
  });
  const sendReply = button("发送至任务消息列", () => {
    if (slot.state !== "idle" || !selectedThreadId || !reply.value.trim())
      return;
    const sentBody = reply.value;
    void slot
      .submit({
        action: "task-thread-reply",
        session: roomSession(context.client, roomId),
        payload: { threadId: selectedThreadId, body: reply.value },
        send: (payload, basedOnRoomSeq, idempotencyKey) =>
          context.client.request("thread.reply", {
            roomId,
            ...payload,
            basedOnRoomSeq,
            idempotencyKey,
            recipientIds: [],
          }),
        onSettled: (outcome) =>
          reportOutcome(status, outcome, "回复失败", () => {
            if (reply.value === sentBody) reply.value = "";
            setStatus(status, "ok", "已发送");
            poller.runNow();
          }),
      })
      .catch(() => undefined);
  });
  reply.addEventListener("keydown", (event) => {
    if (composerKeyAction(event) !== "submit") return;
    event.preventDefault();
    sendReply.click();
  });

  const title = el("input", { attrs: { id: "task-title" } });
  const source = el("input", {
    attrs: { id: "task-source", placeholder: "message_…（可留空）" },
  });
  const assignee = el("input", {
    attrs: { id: "task-assignee", placeholder: "实例 ID（可留空，开放领取）" },
  });
  const description = el("textarea", {
    attrs: { id: "task-description", placeholder: "交付目标与验收标准" },
  });
  const create = button("创建 / 转为任务", () => {
    if (slot.state !== "idle") return;
    if (!source.value.trim() && !title.value.trim()) {
      setStatus(status, "error", "请输入任务标题或来源消息 ID");
      return;
    }
    const submitted = [
      title.value,
      source.value,
      assignee.value,
      description.value,
    ];
    void slot
      .submit({
        action: "task-create",
        session: roomSession(context.client, roomId),
        payload: {
          title: title.value.trim(),
          messageId: source.value.trim(),
          assigneeId: assignee.value.trim(),
          description: description.value.trim(),
        },
        send: (payload, basedOnRoomSeq, idempotencyKey) => {
          const common = {
            roomId,
            basedOnRoomSeq,
            idempotencyKey,
            dependencyTaskIds: [],
            ...(payload.assigneeId ? { assigneeId: payload.assigneeId } : {}),
            ...(payload.description
              ? { description: payload.description }
              : {}),
          };
          return payload.messageId
            ? context.client.request("task.convert", {
                ...common,
                messageId: payload.messageId,
              })
            : context.client.request("task.create", {
                ...common,
                title: payload.title,
              });
        },
        onSettled: (outcome) =>
          reportOutcome(status, outcome, "创建失败", () => {
            [title, source, assignee, description].forEach((field, index) => {
              if (field.value === submitted[index]) field.value = "";
            });
            setStatus(status, "ok", "任务已建立");
            poller.runNow();
          }),
      })
      .catch(() => undefined);
  });
  create.id = "task-create";
  const toggle = button("切换实例自主创建权限", () => {
    if (slot.state !== "idle") return;
    const room = context.rooms.find((item) => item.roomId === roomId);
    if (!room) return;
    void slot
      .submit({
        action: "task-policy",
        session: roomSession(context.client, roomId),
        payload: {
          roomId,
          name: room.name,
          visibility: room.visibility ?? "private",
          description: room.description,
          allowInstanceTaskCreation: !room.allowInstanceTaskCreation,
        },
        send: (payload, basedOnRoomSeq, idempotencyKey) =>
          context.client.request("room.update", {
            ...payload,
            basedOnRoomSeq,
            idempotencyKey,
          }),
        onSettled: (outcome) =>
          reportOutcome(status, outcome, "设置失败", (result) => {
            const index = context.rooms.findIndex(
              (item) => item.roomId === roomId,
            );
            if (index >= 0)
              context.rooms = context.rooms.map((room, at) =>
                at === index ? result.room : room,
              );
            context.refreshRooms();
            setStatus(status, "ok", "创建政策已更新；现有任务继续执行。");
            poller.runNow();
          }),
      })
      .catch(() => undefined);
  });
  toggle.id = "task-policy-toggle";
  slot.onChange((state) => {
    for (const input of [
      title,
      source,
      assignee,
      description,
      create,
      toggle,
      reply,
      sendReply,
    ])
      input.disabled = state !== "idle";
    for (const input of list.querySelectorAll("button"))
      input.disabled = state !== "idle";
  });
  const poller = new Poller(5000, async (signal) => {
    const currentRoom = context.rooms.find((item) => item.roomId === roomId);
    policy.textContent = !currentRoom
      ? "创建政策尚未加载"
      : currentRoom.allowInstanceTaskCreation
        ? "允许实例自主创建任务：可能出现误建，可人工关闭。"
        : "实例自主创建已关闭：实例可发消息建议，Human 创建或转换；已有开放任务仍可领取。";
    try {
      const response = await context.client.request(
        "task.list",
        { roomId, limit: 50 },
        { signal },
      );
      if (signal.aborted) return;
      list.replaceChildren(
        ...response.tasks.map((task) =>
          el("div", { className: "task-row" }, [
            el("strong", { text: `任务 #${task.taskNumber} ${task.title}` }),
            button("查看消息列", () => {
              if (slot.state !== "idle") return;
              selectedThreadId = task.threadId;
              threadHeading.textContent = `任务 #${task.taskNumber} 消息列（最近 50 条）`;
              threadMessages.replaceChildren();
              poller.runNow();
            }),
            el("p", {
              text: `状态：${task.state}；负责人：${task.assigneeId ?? "未指派"}；消息列：${task.threadId}`,
            }),
            el("p", { text: task.description ?? "" }),
            el("p", {
              text: task.submissionSummary ?? task.lastProgress ?? "尚无提交",
            }),
            button("验收完成", () => finish(task.taskId, "task.complete"), {
              attrs: slot.state !== "idle" ? { disabled: "" } : {},
            }),
            button("关闭任务", () => finish(task.taskId, "task.cancel"), {
              attrs: slot.state !== "idle" ? { disabled: "" } : {},
            }),
          ]),
        ),
      );

      const target = selectedThreadId;
      if (target) {
        const messages = await context.client.request(
          "message.list",
          { roomId, threadId: target, limit: 50 },
          { signal },
        );
        if (signal.aborted || target !== selectedThreadId) return;
        threadMessages.replaceChildren(
          ...messages.messages.map((message) =>
            el("p", { text: `${message.actorId}: ${message.body}` }),
          ),
        );
      }
      if (!response.tasks.length) list.append(el("p", { text: "暂无任务" }));
      if (response.nextBeforeTaskNumber)
        list.append(el("p", { text: "仅显示最近 50 项任务" }));
    } catch (error) {
      if (!signal.aborted) setStatus(status, "error", errorText(error));
    }
  });
  function finish(taskId: string, command: "task.complete" | "task.cancel") {
    if (slot.state !== "idle") return;
    void slot
      .submit({
        action: command,
        session: roomSession(context.client, roomId),
        payload: { taskId },
        send: (payload, basedOnRoomSeq, idempotencyKey) =>
          context.client.request(command, {
            ...payload,
            basedOnRoomSeq,
            idempotencyKey,
          }),
        onSettled: (outcome) =>
          reportOutcome(status, outcome, "操作失败", () => {
            setStatus(status, "ok", "已更新任务");
            poller.runNow();
          }),
      })
      .catch(() => undefined);
  }
  const element = el(
    "section",
    { className: "panel", attrs: { id: "tasks-panel" } },
    [
      el("h2", { text: "任务" }),
      policy,
      toggle,
      reply,
      sendReply,
      labelled("新任务标题", title),
      labelled("或将历史顶层消息转为任务", source),
      labelled("负责人", assignee),
      labelled("交付说明", description),
      create,
      status,
      intentControls(slot, "tasks", status),
      list,
      threadHeading,
      threadMessages,
      reply,
      sendReply,
    ],
  );
  poller.start();
  return { element, stop: () => poller.stop() };
}
