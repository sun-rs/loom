import type { RoleListResponse } from "@rah-os/protocol";

import {
  ActionGate,
  activeWorkHint,
  buildMessagePost,
  composerKeyAction,
  lifecycleEvents,
  runRoomAction,
  sosState,
} from "./actions.ts";
import { errorText, isAbort, roomSession } from "./api.ts";
import { subscribe, type ConsoleContext } from "./context.ts";
import {
  button,
  el,
  field,
  labelled,
  localTime,
  present,
  setOptions,
  setStatus,
} from "./dom.ts";
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

const RESET_CONSEQUENCE =
  "重置后，该实例下一次运行会启动新的原生 CLI session，之前的对话上下文不再延续；Room 历史与私有记忆保留。实例有运行中的工作时服务端会拒绝。因会话连续性失败而隔离的激活会在新 session 中重新排队。";
const REMOVE_CONSEQUENCE =
  "移出后不再向该实例投递，历史保留；需要时只能重新实例化一个新实例。实例在本频道或私聊里仍有未结束的工作时服务端会拒绝。";
const SOS_CONSEQUENCE =
  "急停会终止本频道正在运行的实例（需要运行终止证明），恢复前不会开始新的运行。恢复时需要写给实例的指引。";

/** Inline confirmation: the consequence text and explicit confirm/cancel. */
function confirmBox(input: {
  confirmClass: string;
  confirmLabel: string;
  consequence: string;
  onCancel: () => void;
  onConfirm: () => void;
}): HTMLElement {
  return el(
    "div",
    { className: "confirm-box", attrs: { role: "alertdialog" } },
    [
      el("p", { text: input.consequence }),
      el("div", { className: "form-actions" }, [
        button(input.confirmLabel, input.onConfirm, {
          className: `danger ${input.confirmClass}`,
        }),
        button("取消", input.onCancel, {
          className: "secondary confirm-cancel",
        }),
      ]),
    ],
  );
}

type CardView = {
  root: HTMLElement;
  update: (status: InstanceStatus) => void;
};

function instanceCard(
  context: ConsoleContext,
  roomId: string,
  initial: InstanceStatus,
  refresh: () => void,
): CardView {
  const gate = new ActionGate();
  const info = el("div", { className: "instance-info" });
  const confirmArea = el("div", { className: "confirm-area" });
  const result = el("p", { className: "action-status action-result" });
  const hint = el("p", { className: "muted action-hint" });
  let status = initial;

  const reset = () =>
    gate.run(async () => {
      confirmArea.replaceChildren();
      hint.textContent = "";
      setStatus(result, "info", "重置中…");
      try {
        const response = await runRoomAction({
          action: "session-reset",
          session: roomSession(context.client, roomId),
          mutate: (basedOnRoomSeq, idempotencyKey) =>
            context.client.request("instance.session.reset", {
              basedOnRoomSeq,
              idempotencyKey,
              instanceId: status.instanceId,
            }),
        });
        setStatus(
          result,
          "ok",
          `session 已重置：代数 ${String(response.sessionGeneration)}，事件 #${String(response.event.roomSeq)}`,
        );
        refresh();
      } catch (error) {
        setStatus(result, "error", `重置被拒绝：${errorText(error)}`);
      }
    });
  const remove = () =>
    gate.run(async () => {
      confirmArea.replaceChildren();
      hint.textContent = "";
      setStatus(result, "info", "移出中…");
      try {
        await runRoomAction({
          action: "instance-remove",
          session: roomSession(context.client, roomId),
          mutate: (basedOnRoomSeq, idempotencyKey) =>
            context.client.request("room.member.remove", {
              basedOnRoomSeq,
              idempotencyKey,
              principalId: status.instanceId,
              roomId,
            }),
        });
        setStatus(result, "ok", "已移出频道");
        refresh();
      } catch (error) {
        setStatus(result, "error", `移出被拒绝：${errorText(error)}`);
        hint.textContent = activeWorkHint(error) ?? "";
      }
    });

  const resetButton = button(
    "重置 session…",
    () => {
      confirmArea.replaceChildren(
        confirmBox({
          confirmClass: "confirm-reset",
          confirmLabel: "确认重置",
          consequence: RESET_CONSEQUENCE,
          onCancel: () => confirmArea.replaceChildren(),
          onConfirm: () => void reset().catch(() => undefined),
        }),
      );
    },
    { className: "secondary action-reset" },
  );
  const removeButton = button(
    "移出频道…",
    () => {
      confirmArea.replaceChildren(
        confirmBox({
          confirmClass: "confirm-remove",
          confirmLabel: "确认移出",
          consequence: REMOVE_CONSEQUENCE,
          onCancel: () => confirmArea.replaceChildren(),
          onConfirm: () => void remove().catch(() => undefined),
        }),
      );
    },
    { className: "secondary action-remove" },
  );
  const actions = el("div", { className: "form-actions instance-actions" }, [
    resetButton,
    removeButton,
  ]);
  gate.onChange((pending) => {
    resetButton.disabled = pending;
    removeButton.disabled = pending;
    for (const node of confirmArea.querySelectorAll("button")) {
      node.disabled = pending;
    }
  });

  const root = el("li", { attrs: { "data-instance-id": initial.instanceId } }, [
    info,
    actions,
    confirmArea,
    result,
    hint,
  ]);
  const update = (next: InstanceStatus) => {
    status = next;
    root.className = `instance-card state-${next.member ? (next.state ?? "none") : "removed"}`;
    actions.hidden = !next.member;
    if (!next.member) confirmArea.replaceChildren();
    info.replaceChildren(
      ...present(
        el("div", { className: "instance-head" }, [
          el("strong", { className: "instance-name", text: next.roleName }),
          el("span", {
            className: "muted instance-handle",
            text: ` @${next.handle}`,
          }),
          el("span", {
            className: `revision ${next.isCurrent ? "is-current" : "is-stale"}`,
            text: next.isCurrent ? "Role 为最新修订" : "Role 已有新修订",
          }),
        ]),
        field("实例", next.instanceId, "instance-id"),
        field("状态", next.stateLabel, "instance-state"),
        field("排队", next.queuedLabel, "instance-queued"),
        next.updatedAt === null
          ? null
          : field("状态更新", localTime(next.updatedAt)),
        next.lastError === null
          ? null
          : field("最近错误", next.lastError, "last-error"),
        next.watchdogWarning === null
          ? null
          : field("看门狗", next.watchdogWarning, "watchdog-warning"),
        field("私聊", next.privateBoxLabel, "private-box"),
        next.recentProblems.length === 0
          ? null
          : el("div", { className: "problems" }, [
              el("span", { className: "field-label", text: "最近告警/失败" }),
              el(
                "ul",
                {},
                next.recentProblems.map((problem) =>
                  el("li", {
                    className: `problem tone-${problem.tone}`,
                    text: `${localTime(problem.createdAt)} · ${problem.eventType} · #${problem.roomName}`,
                  }),
                ),
              ),
            ]),
      ),
    );
  };
  update(initial);
  return { root, update };
}

export function mountChannel(
  container: HTMLElement,
  context: ConsoleContext,
  roomId: string,
): () => void {
  const header = el("section", { className: "panel channel-header" });
  const notice = el("div", { attrs: { id: "wake-notice" } });
  const instanceBody = el("div");
  const messageList = el("ol", {
    attrs: { id: "message-list" },
    className: "message-list",
  });
  const messageStatus = el("p", { className: "muted", text: "加载中…" });
  const lifecycleList = el("ol", {
    attrs: { id: "lifecycle-events" },
    className: "lifecycle-list",
  });
  let messageWindow: MessageWindow | undefined;
  let statuses: InstanceStatus[] = [];
  let roles: RoleListResponse["roles"] = [];
  const cards = new Map<string, CardView>();
  const cardList = el("ul", {
    attrs: { id: "instance-list" },
    className: "instance-list",
  });

  // --- Composer: Enter sends, Shift+Enter newline, IME never sends. ---
  const composerGate = new ActionGate();
  const mention = el("select", { attrs: { id: "composer-mention" } });
  const input = el("textarea", {
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
  const submitMessage = () =>
    composerGate.run(async () => {
      if (context.identity === undefined) {
        setStatus(composerStatus, "error", "尚未连接，无法发送");
        return;
      }
      const target = statuses.find(
        ({ instanceId, member }) => member && instanceId === mention.value,
      );
      const post = buildMessagePost(
        input.value,
        target === undefined
          ? undefined
          : { handle: target.handle, participantId: target.instanceId },
      );
      if (!post.ok) {
        setStatus(composerStatus, "error", post.error);
        return;
      }
      setStatus(composerStatus, "info", "发送中…");
      try {
        await runRoomAction({
          action: "message",
          session: roomSession(context.client, roomId),
          mutate: (basedOnRoomSeq, idempotencyKey) =>
            context.client.request("message.post", {
              basedOnRoomSeq,
              body: post.value.body,
              idempotencyKey,
              recipients: post.value.recipients,
              roomId,
            }),
        });
        input.value = "";
        setStatus(composerStatus, "ok", "已发送");
        poller.runNow();
      } catch (error) {
        setStatus(composerStatus, "error", `发送失败：${errorText(error)}`);
      }
    });
  composerGate.onChange((pending) => {
    send.disabled = pending;
    send.textContent = pending ? "发送中…" : "发送";
  });
  send.addEventListener("click", () => {
    void submitMessage().catch(() => undefined);
  });
  input.addEventListener("keydown", (event) => {
    if (composerKeyAction(event) !== "submit") return;
    // Keyboard and button share one gate: a pending send refuses both.
    event.preventDefault();
    void submitMessage().catch(() => undefined);
  });

  // --- Instantiate a Role into this Channel. ---
  const instantiateGate = new ActionGate();
  const roleSelect = el("select", { attrs: { id: "instantiate-role" } });
  const instantiateButton = el("button", {
    attrs: { id: "instantiate-submit", type: "button" },
    text: "实例化进频道",
  });
  const instantiateStatus = el("p", {
    attrs: { id: "instantiate-status", role: "status" },
    className: "action-status",
  });
  instantiateGate.onChange((pending) => {
    instantiateButton.disabled = pending;
  });
  instantiateButton.addEventListener("click", () => {
    void instantiateGate
      .run(async () => {
        const role = roles.find(({ roleId }) => roleId === roleSelect.value);
        if (role === undefined) {
          setStatus(instantiateStatus, "error", "请选择 Role");
          return;
        }
        setStatus(instantiateStatus, "info", "实例化中…");
        try {
          const result = await runRoomAction({
            action: "instantiate",
            session: roomSession(context.client, roomId),
            mutate: (basedOnRoomSeq, idempotencyKey) =>
              context.client.request("role.instantiate", {
                basedOnRoomSeq,
                channelId: roomId,
                idempotencyKey,
                roleId: role.roleId,
              }),
          });
          setStatus(
            instantiateStatus,
            "ok",
            `已实例化 @${result.agent.handle}（${result.instance.instanceId}）`,
          );
          poller.runNow();
        } catch (error) {
          setStatus(
            instantiateStatus,
            "error",
            `实例化失败：${errorText(error)}`,
          );
        }
      })
      .catch(() => undefined);
  });

  // --- Channel emergency stop / resume. ---
  const sosGate = new ActionGate();
  const sosLabel = el("span", {
    attrs: { id: "sos-state" },
    className: "field-value",
  });
  const sosConfirm = el("div", { attrs: { id: "sos-confirm" } });
  const guidance = el("textarea", {
    attrs: {
      id: "sos-guidance",
      placeholder: "恢复指引（发给本频道的实例，必填）",
      rows: "2",
    },
  });
  const sosStatus = el("p", {
    attrs: { id: "sos-status", role: "status" },
    className: "action-status",
  });
  const stop = () =>
    sosGate.run(async () => {
      sosConfirm.replaceChildren();
      setStatus(sosStatus, "info", "急停中…");
      try {
        const result = await runRoomAction({
          action: "sos-stop",
          session: roomSession(context.client, roomId),
          mutate: (basedOnRoomSeq, idempotencyKey) =>
            context.client.request("room.sos.stop", {
              basedOnRoomSeq,
              idempotencyKey,
              roomId,
            }),
        });
        setStatus(
          sosStatus,
          "ok",
          result.operation.state === "stopped"
            ? "已急停"
            : `急停中：等待 ${String(result.operation.pendingTargetCount)} 个运行终止证明`,
        );
        poller.runNow();
      } catch (error) {
        setStatus(sosStatus, "error", `急停失败：${errorText(error)}`);
      }
    });
  const resume = () =>
    sosGate.run(async () => {
      const text = guidance.value.trim();
      if (text.length === 0) {
        setStatus(sosStatus, "error", "恢复需要填写指引");
        return;
      }
      setStatus(sosStatus, "info", "恢复中…");
      try {
        await runRoomAction({
          action: "sos-resume",
          session: roomSession(context.client, roomId),
          mutate: (basedOnRoomSeq, idempotencyKey) =>
            context.client.request("room.sos.resume", {
              basedOnRoomSeq,
              guidance: text,
              idempotencyKey,
              roomId,
            }),
        });
        guidance.value = "";
        setStatus(sosStatus, "ok", "已恢复");
        poller.runNow();
      } catch (error) {
        setStatus(sosStatus, "error", `恢复失败：${errorText(error)}`);
      }
    });
  const stopButton = button(
    "急停…",
    () => {
      sosConfirm.replaceChildren(
        confirmBox({
          confirmClass: "confirm-sos-stop",
          confirmLabel: "确认急停",
          consequence: SOS_CONSEQUENCE,
          onCancel: () => sosConfirm.replaceChildren(),
          onConfirm: () => void stop().catch(() => undefined),
        }),
      );
    },
    { attrs: { id: "sos-stop" }, className: "danger" },
  );
  const resumeButton = button(
    "恢复",
    () => void resume().catch(() => undefined),
    { attrs: { id: "sos-resume" } },
  );
  sosGate.onChange((pending) => {
    stopButton.disabled = pending;
    resumeButton.disabled = pending;
    for (const node of sosConfirm.querySelectorAll("button")) {
      node.disabled = pending;
    }
  });

  container.replaceChildren(
    header,
    notice,
    el("section", { className: "panel sos-panel" }, [
      el("h2", { text: "频道急停" }),
      el("div", { className: "field" }, [
        el("span", { className: "field-label", text: "状态" }),
        sosLabel,
      ]),
      el("div", { className: "form-actions" }, [stopButton]),
      sosConfirm,
      labelled("恢复指引", guidance),
      el("div", { className: "form-actions" }, [resumeButton]),
      sosStatus,
    ]),
    el("div", { className: "channel-body" }, [
      el("section", { className: "panel" }, [
        el("h2", { text: "实例状态" }),
        instanceBody,
        el("div", { className: "instantiate-row" }, [
          labelled("添加实例（选择 Role）", roleSelect),
          el("div", { className: "form-actions" }, [instantiateButton]),
          instantiateStatus,
        ]),
      ]),
      el("section", { className: "panel messages" }, [
        el("h2", { text: "消息（最近 50 条）" }),
        messageStatus,
        messageList,
        el("div", { className: "composer" }, [
          labelled("@ 实例（可选）", mention),
          input,
          el("div", { className: "form-actions" }, [send]),
          composerStatus,
        ]),
      ]),
    ]),
    el("section", { className: "panel" }, [
      el("h2", { text: "最近生命周期事件（已同步的事件窗口）" }),
      lifecycleList,
    ]),
  );

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
    const seen = new Set<string>();
    for (const status of statuses) {
      seen.add(status.instanceId);
      const existing = cards.get(status.instanceId);
      if (existing === undefined) {
        cards.set(
          status.instanceId,
          instanceCard(context, roomId, status, () => poller.runNow()),
        );
      } else existing.update(status);
    }
    for (const [instanceId, card] of cards) {
      if (!seen.has(instanceId)) {
        card.root.remove();
        cards.delete(instanceId);
      }
    }
    // Keeps card nodes (and any open confirmation) across polls.
    statuses.forEach((status, index) => {
      const node = cards.get(status.instanceId)!.root;
      if (cardList.children[index] !== node) {
        cardList.insertBefore(node, cardList.children[index] ?? null);
      }
    });
    instanceBody.replaceChildren(
      ...present(
        error === undefined
          ? null
          : el("p", { className: "error", text: `实例状态读取失败：${error}` }),
        statuses.length === 0 && error === undefined
          ? el("p", { className: "muted", text: "本频道没有 Role 实例" })
          : null,
        cardList,
      ),
    );
    setOptions(
      mention,
      statuses
        .filter(({ member }) => member)
        .map(({ handle, instanceId, roleName }) => ({
          label: `@${handle}（${roleName}）`,
          value: instanceId,
        })),
      "不 @ 任何实例",
    );
  };

  const renderEvents = () => {
    const events = roomSession(context.client, roomId).state.events;
    sosLabel.textContent = sosState(events).label;
    const lifecycle = lifecycleEvents(events);
    lifecycleList.replaceChildren(
      ...(lifecycle.length === 0
        ? [el("li", { className: "muted", text: "窗口内没有生命周期事件" })]
        : lifecycle.map((event) =>
            el(
              "li",
              {
                attrs: {
                  "data-event-type": event.type,
                  "data-room-seq": String(event.roomSeq),
                },
                className: "lifecycle-event",
              },
              [
                el("span", {
                  className: "muted",
                  text: `#${String(event.roomSeq)} · ${localTime(event.createdAt)} · `,
                }),
                el("span", { text: event.label }),
                event.subject === null
                  ? null
                  : el("span", {
                      className: "muted",
                      text: ` · ${actorLabel(event.subject)}`,
                    }),
              ],
            ),
          )),
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
    try {
      // The same causal session every write is based on.
      await roomSession(context.client, roomId).syncUntilCurrent({
        maxPages: 10,
        signal,
      });
      if (signal.aborted) return;
      renderEvents();
    } catch (error) {
      if (signal.aborted || isAbort(error)) return;
      sosLabel.textContent = `事件同步失败：${errorText(error)}`;
    }
    const identity = context.identity;
    if (identity === undefined) return;
    try {
      const next = await loadInstanceStatuses(
        context.client,
        { controlRoomId: identity.controlRoomId, roomId, rooms: context.rooms },
        { signal },
      );
      const roleList = await context.client.request(
        "role.list",
        { controlRoomId: identity.controlRoomId },
        { signal },
      );
      if (signal.aborted) return;
      // role.list stops listing an instance once it leaves the Channel;
      // keep what this page already knew, marked removed, so the result of
      // the removal and the author labels stay readable until a reload.
      const listed = new Set(next.map(({ instanceId }) => instanceId));
      statuses = [
        ...next,
        ...statuses
          .filter(({ instanceId }) => !listed.has(instanceId))
          .map((previous) => ({
            ...previous,
            lastError: null,
            member: false,
            queuedCount: 0,
            queuedLabel: "—",
            state: undefined,
            stateLabel: "已移出频道",
            updatedAt: null,
          })),
      ];
      roles = roleList.roles;
      setOptions(
        roleSelect,
        roles.map((role) => ({
          label: `${role.configuration.displayName} @${role.configuration.handle}`,
          value: role.roleId,
        })),
        roles.length === 0 ? "还没有 Role（先到 Role 页创建）" : "选择 Role",
      );
      renderInstances();
      renderMessages();
      renderEvents();
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
