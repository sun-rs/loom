import { errorText, isAbort } from "./api.ts";
import { subscribe, type ConsoleContext } from "./context.ts";
import { el, field, localTime, present } from "./dom.ts";
import {
  SYSTEM_PRINCIPAL_ID,
  loadInstanceStatuses,
  loadLatestMessages,
  loadNewerMessages,
  summarizeChannels,
  wakeLimitNotice,
  type InstanceStatus,
  type MessageWindow,
} from "./model.ts";
import { Poller } from "./poll.ts";

const CHANNEL_POLL_MS = 3_000;

function instanceCard(status: InstanceStatus): HTMLElement {
  return el(
    "li",
    {
      attrs: { "data-instance-id": status.instanceId },
      className: `instance-card state-${status.state ?? "none"}`,
    },
    [
      el("div", { className: "instance-head" }, [
        el("strong", { className: "instance-name", text: status.roleName }),
        el("span", { className: "muted", text: ` @${status.handle}` }),
        el("span", {
          className: `revision ${status.isCurrent ? "is-current" : "is-stale"}`,
          text: status.isCurrent ? "Role 为最新修订" : "Role 已有新修订",
        }),
      ]),
      field("实例", status.instanceId, "instance-id"),
      field("状态", status.stateLabel, "instance-state"),
      status.updatedAt === null
        ? null
        : field("状态更新", localTime(status.updatedAt)),
      status.lastError === null
        ? null
        : field("最近错误", status.lastError, "last-error"),
      status.watchdogWarning === null
        ? null
        : field("看门狗", status.watchdogWarning, "watchdog-warning"),
      field("私聊", status.privateBoxLabel, "private-box"),
      status.recentProblems.length === 0
        ? null
        : el("div", { className: "problems" }, [
            el("span", { className: "field-label", text: "最近告警/失败" }),
            el(
              "ul",
              {},
              status.recentProblems.map((problem) =>
                el("li", {
                  className: `problem tone-${problem.tone}`,
                  text: `${localTime(problem.createdAt)} · ${problem.eventType} · #${problem.roomName}`,
                }),
              ),
            ),
          ]),
    ],
  );
}

export function mountChannel(
  container: HTMLElement,
  context: ConsoleContext,
  roomId: string,
): () => void {
  const header = el("section", { className: "panel channel-header" });
  const notice = el("div", { attrs: { id: "wake-notice" } });
  const instances = el("section", { className: "panel" });
  const messageList = el("ol", {
    attrs: { id: "message-list" },
    className: "message-list",
  });
  const messageStatus = el("p", { className: "muted", text: "加载中…" });
  container.replaceChildren(
    header,
    notice,
    el("div", { className: "channel-body" }, [
      instances,
      el("section", { className: "panel messages" }, [
        el("h2", { text: "消息（只读，最近 50 条）" }),
        messageStatus,
        messageList,
      ]),
    ]),
  );
  let messageWindow: MessageWindow | undefined;
  let statuses: InstanceStatus[] = [];

  const renderHeader = () => {
    const summary = summarizeChannels(context.rooms).find(
      (candidate) => candidate.roomId === roomId,
    );
    header.replaceChildren(
      el("h2", {
        attrs: { id: "channel-title" },
        text: summary === undefined ? roomId : `#${summary.name}`,
      }),
      summary === undefined
        ? el("p", {
            className: "muted",
            text: context.roomsLoaded ? "频道不存在或已归档" : "加载中…",
          })
        : summary.legacyPrivateCwd
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
    );
  };

  const actorLabel = (actorId: string): string => {
    if (actorId === SYSTEM_PRINCIPAL_ID) return "Loom 系统";
    if (actorId === context.identity?.principalId) {
      return `${context.identity.displayName}（Human）`;
    }
    const instance = statuses.find(({ instanceId }) => instanceId === actorId);
    return instance === undefined
      ? actorId
      : `${instance.roleName} @${instance.handle}`;
  };

  const renderMessages = () => {
    if (messageWindow === undefined) return;
    const nearBottom =
      messageList.scrollHeight -
        messageList.scrollTop -
        messageList.clientHeight <
      48;
    messageStatus.textContent =
      messageWindow.messages.length === 0 ? "暂无消息" : "";
    messageList.replaceChildren(
      ...messageWindow.messages.map((message) =>
        el(
          "li",
          {
            attrs: { "data-room-seq": String(message.roomSeq) },
            className: `message${message.system ? " is-system" : ""}`,
          },
          [
            el("div", { className: "message-meta" }, [
              el("span", {
                className: "message-actor",
                text: actorLabel(message.actorId),
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
    if (nearBottom) messageList.scrollTop = messageList.scrollHeight;
    const wake =
      context.identity === undefined
        ? null
        : wakeLimitNotice(messageWindow.messages, context.identity.principalId);
    notice.replaceChildren(
      ...(wake === null
        ? []
        : [
            el("div", { className: "wake-notice", attrs: { role: "alert" } }, [
              el("strong", {
                text: "唤醒已达上限（Human 发言前实例不会互相唤醒）",
              }),
              el("p", { text: wake }),
            ]),
          ]),
    );
  };

  const renderInstances = (error?: string) => {
    instances.replaceChildren(
      ...present(
        el("h2", { text: "实例状态" }),
        error === undefined
          ? null
          : el("p", { className: "error", text: `实例状态读取失败：${error}` }),
        statuses.length === 0 && error === undefined
          ? el("p", { className: "muted", text: "本频道没有 Role 实例" })
          : el(
              "ul",
              { attrs: { id: "instance-list" }, className: "instance-list" },
              statuses.map(instanceCard),
            ),
      ),
    );
  };

  const poller = new Poller(CHANNEL_POLL_MS, async (signal) => {
    try {
      const next =
        messageWindow === undefined
          ? await loadLatestMessages(context.client, roomId, { signal })
          : await loadNewerMessages(context.client, roomId, messageWindow, {
              signal,
            });
      if (signal.aborted) return;
      messageWindow = next;
      renderMessages();
    } catch (error) {
      if (signal.aborted || isAbort(error)) return;
      messageStatus.textContent = `消息读取失败：${errorText(error)}`;
    }
    const identity = context.identity;
    if (identity === undefined) return;
    try {
      const next = await loadInstanceStatuses(
        context.client,
        { controlRoomId: identity.controlRoomId, roomId, rooms: context.rooms },
        { signal },
      );
      if (signal.aborted) return;
      statuses = next;
      renderInstances();
      renderMessages();
    } catch (error) {
      if (signal.aborted || isAbort(error)) return;
      renderInstances(errorText(error));
    }
  });
  renderHeader();
  renderInstances();
  let hadIdentity = context.identity !== undefined;
  const unsubscribe = subscribe(context, () => {
    renderHeader();
    if (!hadIdentity && context.identity !== undefined) {
      hadIdentity = true;
      poller.runNow();
    }
  });
  poller.start();
  return () => {
    unsubscribe();
    poller.stop();
  };
}
