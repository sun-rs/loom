import type { RoleListResponse } from "@rah-os/protocol";

import {
  WriteIntentSlot,
  activeWorkHint,
  lifecycleEvents,
  sosState,
  type IntentState,
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
  INTENT_BUSY_UNKNOWN,
  intentControls,
  reportOutcome,
} from "./intent-view.ts";
import {
  SYSTEM_PRINCIPAL_ID,
  loadInstanceStatuses,
  summarizeChannels,
  wakeLimitNotice,
  type InstanceStatus,
} from "./model.ts";
import { Poller } from "./poll.ts";
import { memoryPanel } from "./view-memory.ts";
import { messagePanel } from "./view-messages.ts";
import { runDetailPanel, runList, type RunDetailPanel } from "./view-run.ts";

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

function instanceCard(input: {
  context: ConsoleContext;
  initial: InstanceStatus;
  refresh: () => void;
  roomId: string;
  runDetail: RunDetailPanel;
}): CardView {
  const { context, roomId } = input;
  // One intent per card: reset, removal and opening the private box.
  const slot = new WriteIntentSlot();
  const info = el("div", { className: "instance-info" });
  const confirmArea = el("div", { className: "confirm-area" });
  const result = el("p", { className: "action-status action-result" });
  const hint = el("p", { className: "muted action-hint" });
  let status = input.initial;

  const refusedWhileUnknown = (): boolean => {
    if (slot.state === "unknown") {
      setStatus(result, "error", INTENT_BUSY_UNKNOWN);
      return true;
    }
    return slot.state === "pending";
  };
  const reset = () => {
    if (refusedWhileUnknown()) return;
    confirmArea.replaceChildren();
    hint.textContent = "";
    setStatus(result, "info", "重置中…");
    void slot
      .submit({
        action: "session-reset",
        payload: { instanceId: status.instanceId },
        session: roomSession(context.client, roomId),
        send: (payload, basedOnRoomSeq, idempotencyKey) =>
          context.client.request("instance.session.reset", {
            basedOnRoomSeq,
            idempotencyKey,
            instanceId: payload.instanceId,
          }),
        onSettled: (outcome) =>
          reportOutcome(result, outcome, "重置被拒绝", (response) => {
            setStatus(
              result,
              "ok",
              `session 已重置：代数 ${String(response.sessionGeneration)}，事件 #${String(response.event.roomSeq)}${response.deduplicated ? "（重试核实：原请求已执行）" : ""}`,
            );
            input.refresh();
          }),
      })
      .catch(() => undefined);
  };
  const remove = () => {
    if (refusedWhileUnknown()) return;
    confirmArea.replaceChildren();
    hint.textContent = "";
    setStatus(result, "info", "移出中…");
    void slot
      .submit({
        action: "instance-remove",
        payload: { principalId: status.instanceId, roomId },
        session: roomSession(context.client, roomId),
        send: (payload, basedOnRoomSeq, idempotencyKey) =>
          context.client.request("room.member.remove", {
            basedOnRoomSeq,
            idempotencyKey,
            principalId: payload.principalId,
            roomId: payload.roomId,
          }),
        onSettled: (outcome) => {
          reportOutcome(result, outcome, "移出被拒绝", () => {
            setStatus(result, "ok", "已移出频道");
            input.refresh();
          });
          if (outcome.kind === "rejected") {
            hint.textContent = activeWorkHint(outcome.error) ?? "";
          }
        },
      })
      .catch(() => undefined);
  };
  const openPrivateBox = () => {
    if (refusedWhileUnknown()) return;
    const identity = context.identity;
    if (identity === undefined) {
      setStatus(result, "error", "尚未连接，无法打开私聊");
      return;
    }
    setStatus(result, "info", "打开私聊中…");
    void slot
      .submit({
        action: "direct-open",
        payload: {
          peerPrincipalId: status.instanceId,
          workspaceId: identity.workspaceId,
        },
        session: roomSession(context.client, identity.controlRoomId),
        send: (payload, basedOnControlRoomSeq, idempotencyKey) =>
          context.client.request("room.direct.open", {
            basedOnControlRoomSeq,
            idempotencyKey,
            peerPrincipalId: payload.peerPrincipalId,
            workspaceId: payload.workspaceId,
          }),
        onSettled: (outcome) =>
          reportOutcome(result, outcome, "打开私聊被拒绝", (response) => {
            setStatus(result, "ok", "私聊已打开");
            context.refreshRooms();
            window.location.hash = `#/direct/${encodeURIComponent(response.room.roomId)}`;
          }),
      })
      .catch(() => undefined);
  };

  const resetButton = button(
    "重置 session…",
    () => {
      confirmArea.replaceChildren(
        confirmBox({
          confirmClass: "confirm-reset",
          confirmLabel: "确认重置",
          consequence: RESET_CONSEQUENCE,
          onCancel: () => confirmArea.replaceChildren(),
          onConfirm: reset,
        }),
      );
      renderSlot(slot.state);
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
          onConfirm: remove,
        }),
      );
      renderSlot(slot.state);
    },
    { className: "secondary action-remove" },
  );
  const openBoxButton = button("打开私聊", openPrivateBox, {
    className: "secondary action-open-direct",
  });
  const boxLink = el("a", { className: "open-direct-link", text: "查看私聊" });
  const actions = el("div", { className: "form-actions instance-actions" }, [
    resetButton,
    removeButton,
    openBoxButton,
    boxLink,
  ]);
  const renderSlot = (state: IntentState) => {
    const busy = state !== "idle";
    resetButton.disabled = busy;
    removeButton.disabled = busy;
    openBoxButton.disabled = busy;
    for (const node of confirmArea.querySelectorAll("button")) {
      node.disabled = busy;
    }
  };
  slot.onChange(renderSlot);

  const root = el(
    "li",
    { attrs: { "data-instance-id": input.initial.instanceId } },
    [
      info,
      actions,
      confirmArea,
      result,
      intentControls(slot, `instance-${input.initial.instanceId}`, result),
      hint,
    ],
  );
  const update = (next: InstanceStatus) => {
    status = next;
    root.className = `instance-card state-${next.member ? (next.state ?? "none") : "removed"}`;
    actions.hidden = !next.member;
    if (!next.member) confirmArea.replaceChildren();
    openBoxButton.hidden = next.privateBoxRoomId !== null;
    boxLink.hidden = next.privateBoxRoomId === null;
    if (next.privateBoxRoomId !== null) {
      boxLink.setAttribute(
        "href",
        `#/direct/${encodeURIComponent(next.privateBoxRoomId)}`,
      );
    }
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
        next.member
          ? runList(next.runs, (run) =>
              input.runDetail.show(
                next.agentId,
                run.runAttemptId,
                `${next.roleName} @${next.handle}`,
              ),
            )
          : null,
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
  update(input.initial);
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
  const lifecycleList = el("ol", {
    attrs: { id: "lifecycle-events" },
    className: "lifecycle-list",
  });
  let statuses: InstanceStatus[] = [];
  let roles: RoleListResponse["roles"] = [];
  const cards = new Map<string, CardView>();
  const cardList = el("ul", {
    attrs: { id: "instance-list" },
    className: "instance-list",
  });
  const runDetail = runDetailPanel(context);
  const memory = memoryPanel(context, roomId);

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

  // --- Messages: this Channel only (a private box has its own page). ---
  const mention = el("select", { attrs: { id: "composer-mention" } });
  const messages = messagePanel({
    actorLabel,
    context,
    heading: "消息（最近 50 条）",
    mention,
    mentionTarget: () => {
      const target = statuses.find(
        ({ instanceId, member }) => member && instanceId === mention.value,
      );
      return target === undefined
        ? undefined
        : { handle: target.handle, participantId: target.instanceId };
    },
    onRendered: (window) => {
      const wake =
        context.identity === undefined
          ? null
          : wakeLimitNotice(window.messages, context.identity.principalId);
      notice.replaceChildren(
        ...(wake === null
          ? []
          : [
              el(
                "div",
                { className: "wake-notice", attrs: { role: "alert" } },
                [
                  el("strong", {
                    text: "唤醒已达上限（Human 发言前实例不会互相唤醒）",
                  }),
                  el("p", { text: wake }),
                ],
              ),
            ]),
      );
    },
    pollNow: () => poller.runNow(),
    roomId,
  });

  // --- Instantiate a Role into this Channel. ---
  const instantiateSlot = new WriteIntentSlot();
  const roleSelect = el("select", { attrs: { id: "instantiate-role" } });
  const instantiateButton = el("button", {
    attrs: { id: "instantiate-submit", type: "button" },
    text: "实例化进频道",
  });
  const instantiateStatus = el("p", {
    attrs: { id: "instantiate-status", role: "status" },
    className: "action-status",
  });
  instantiateSlot.onChange((state) => {
    instantiateButton.disabled = state !== "idle";
    roleSelect.disabled = state !== "idle";
  });
  instantiateButton.addEventListener("click", () => {
    if (instantiateSlot.state !== "idle") return;
    const role = roles.find(({ roleId }) => roleId === roleSelect.value);
    if (role === undefined) {
      setStatus(instantiateStatus, "error", "请选择 Role");
      return;
    }
    setStatus(instantiateStatus, "info", "实例化中…");
    void instantiateSlot
      .submit({
        action: "instantiate",
        payload: { channelId: roomId, roleId: role.roleId },
        session: roomSession(context.client, roomId),
        send: (payload, basedOnRoomSeq, idempotencyKey) =>
          context.client.request("role.instantiate", {
            basedOnRoomSeq,
            channelId: payload.channelId,
            idempotencyKey,
            roleId: payload.roleId,
          }),
        onSettled: (outcome) =>
          reportOutcome(
            instantiateStatus,
            outcome,
            "实例化被拒绝",
            (result) => {
              setStatus(
                instantiateStatus,
                "ok",
                `已实例化 @${result.agent.handle}（${result.instance.instanceId}）${result.deduplicated ? "（重试核实：原请求已执行）" : ""}`,
              );
              poller.runNow();
            },
          ),
      })
      .catch(() => undefined);
  });

  // --- Channel emergency stop / resume (one intent for both). ---
  const sosSlot = new WriteIntentSlot();
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
  const sosBusy = (): boolean => {
    if (sosSlot.state === "unknown") {
      setStatus(sosStatus, "error", INTENT_BUSY_UNKNOWN);
      return true;
    }
    return sosSlot.state === "pending";
  };
  const stop = () => {
    if (sosBusy()) return;
    sosConfirm.replaceChildren();
    setStatus(sosStatus, "info", "急停中…");
    void sosSlot
      .submit({
        action: "sos-stop",
        payload: { roomId },
        session: roomSession(context.client, roomId),
        send: (payload, basedOnRoomSeq, idempotencyKey) =>
          context.client.request("room.sos.stop", {
            basedOnRoomSeq,
            idempotencyKey,
            roomId: payload.roomId,
          }),
        onSettled: (outcome) =>
          reportOutcome(sosStatus, outcome, "急停被拒绝", (result) => {
            setStatus(
              sosStatus,
              "ok",
              result.operation.state === "stopped"
                ? "已急停"
                : `急停中：等待 ${String(result.operation.pendingTargetCount)} 个运行终止证明`,
            );
            poller.runNow();
          }),
      })
      .catch(() => undefined);
  };
  const resume = () => {
    if (sosBusy()) return;
    const submitted = guidance.value;
    const text = submitted.trim();
    if (text.length === 0) {
      setStatus(sosStatus, "error", "恢复需要填写指引");
      return;
    }
    setStatus(sosStatus, "info", "恢复中…");
    void sosSlot
      .submit({
        action: "sos-resume",
        payload: { guidance: text, roomId },
        session: roomSession(context.client, roomId),
        send: (payload, basedOnRoomSeq, idempotencyKey) =>
          context.client.request("room.sos.resume", {
            basedOnRoomSeq,
            guidance: payload.guidance,
            idempotencyKey,
            roomId: payload.roomId,
          }),
        onSettled: (outcome) =>
          reportOutcome(sosStatus, outcome, "恢复被拒绝", () => {
            // Guidance edited while the request ran is kept.
            if (guidance.value === submitted) guidance.value = "";
            setStatus(sosStatus, "ok", "已恢复");
            poller.runNow();
          }),
      })
      .catch(() => undefined);
  };
  const stopButton = button(
    "急停…",
    () => {
      sosConfirm.replaceChildren(
        confirmBox({
          confirmClass: "confirm-sos-stop",
          confirmLabel: "确认急停",
          consequence: SOS_CONSEQUENCE,
          onCancel: () => sosConfirm.replaceChildren(),
          onConfirm: stop,
        }),
      );
      renderSos(sosSlot.state);
    },
    { attrs: { id: "sos-stop" }, className: "danger" },
  );
  const resumeButton = button("恢复", resume, { attrs: { id: "sos-resume" } });
  const renderSos = (state: IntentState) => {
    const busy = state !== "idle";
    stopButton.disabled = busy;
    resumeButton.disabled = busy;
    for (const node of sosConfirm.querySelectorAll("button")) {
      node.disabled = busy;
    }
  };
  sosSlot.onChange(renderSos);

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
      intentControls(sosSlot, "sos", sosStatus),
    ]),
    el("div", { className: "channel-body" }, [
      el("section", { className: "panel" }, [
        el("h2", { text: "实例状态" }),
        instanceBody,
        el("div", { className: "instantiate-row" }, [
          labelled("添加实例（选择 Role）", roleSelect),
          el("div", { className: "form-actions" }, [instantiateButton]),
          instantiateStatus,
          intentControls(instantiateSlot, "instantiate", instantiateStatus),
        ]),
      ]),
      messages.element,
    ]),
    runDetail.element,
    memory.element,
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

  const renderInstances = (error?: string) => {
    const seen = new Set<string>();
    for (const status of statuses) {
      seen.add(status.instanceId);
      const existing = cards.get(status.instanceId);
      if (existing === undefined) {
        cards.set(
          status.instanceId,
          instanceCard({
            context,
            initial: status,
            refresh: () => poller.runNow(),
            roomId,
            runDetail,
          }),
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
    await messages.refresh(signal);
    if (signal.aborted) return;
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
      memory.setInstances(
        statuses.map(({ handle, instanceId, member, roleName }) => ({
          instanceId,
          label: `${roleName} @${handle}`,
          member,
        })),
      );
      messages.render();
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
    memory.stop();
  };
}
