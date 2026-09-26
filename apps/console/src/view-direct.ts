/**
 * An instance's private box: its own messages, composer, state and runs.
 * It reads only the private-box Room; the Channel page never shows it.
 * Throwaway: deleted in phase 4.
 */
import { errorText, isAbort } from "./api.ts";
import { subscribe, type ConsoleContext } from "./context.ts";
import { el, field, present } from "./dom.ts";
import {
  SYSTEM_PRINCIPAL_ID,
  UNKNOWN,
  runAttemptsInRoom,
  stateLabel,
} from "./model.ts";
import { Poller } from "./poll.ts";
import { messagePanel } from "./view-messages.ts";
import { runDetailPanel, runList } from "./view-run.ts";

const DIRECT_POLL_MS = 3_000;

type BoxInstance = {
  agentId: string | undefined;
  channelId: string | undefined;
  handle: string | undefined;
  instanceId: string;
  roleName: string | undefined;
};

export function mountDirect(
  container: HTMLElement,
  context: ConsoleContext,
  roomId: string,
): () => void {
  const header = el("section", { className: "panel direct-header" });
  const statusBody = el("div", { attrs: { id: "direct-instance" } });
  const runDetail = runDetailPanel(context);
  let instance: BoxInstance | undefined;

  const box = () =>
    context.rooms.find(
      (room) => room.roomId === roomId && room.instancePrivateBox !== undefined,
    );
  const actorLabel = (actorId: string): string => {
    if (actorId === SYSTEM_PRINCIPAL_ID) return "Loom 系统";
    if (actorId === context.identity?.principalId) {
      return `${context.identity.displayName}（Human）`;
    }
    if (actorId === instance?.instanceId) {
      return `${instance.roleName ?? actorId} @${instance.handle ?? "?"}`;
    }
    return actorId;
  };
  const messages = messagePanel({
    actorLabel,
    context,
    heading: "私聊消息（最近 50 条，只属于这个私聊）",
    pollNow: () => poller.runNow(),
    roomId,
  });

  const renderHeader = () => {
    const room = box();
    const privateBox = room?.instancePrivateBox;
    header.replaceChildren(
      el("h2", {
        attrs: { id: "direct-title" },
        text:
          privateBox === undefined
            ? roomId
            : `私聊 · ${instance?.roleName ?? privateBox.instanceId}${instance?.handle === undefined ? "" : ` @${instance.handle}`}`,
      }),
      privateBox === undefined
        ? el("p", {
            className: "muted",
            text: context.roomsLoaded
              ? "私聊不存在或不可见（只有已打开的实例私聊显示在这里）"
              : "加载中…",
          })
        : el("div", {}, [
            field(
              "私聊状态",
              privateBox.active ? "可用" : "已停用（实例已移出频道；历史只读）",
              "direct-active",
            ),
            instance?.channelId === undefined
              ? null
              : el("a", {
                  attrs: {
                    href: `#/channel/${encodeURIComponent(instance.channelId)}`,
                  },
                  text: "返回所属频道",
                }),
          ]),
    );
  };

  container.replaceChildren(
    header,
    el("div", { className: "channel-body" }, [
      el("section", { className: "panel" }, [
        el("h2", { text: "实例（本私聊）" }),
        statusBody,
      ]),
      messages.element,
    ]),
    runDetail.element,
  );

  const poller = new Poller(DIRECT_POLL_MS, async (signal) => {
    await messages.refresh(signal);
    const identity = context.identity;
    const privateBox = box()?.instancePrivateBox;
    if (signal.aborted || identity === undefined || privateBox === undefined) {
      renderHeader();
      return;
    }
    try {
      const [roleList, agents, activity] = await Promise.all([
        context.client.request(
          "role.list",
          { controlRoomId: identity.controlRoomId },
          { signal },
        ),
        context.client.request(
          "agent.list",
          { controlRoomId: identity.controlRoomId },
          { signal },
        ),
        context.client.request(
          "room.agent.activity.list",
          { roomId },
          { signal },
        ),
      ]);
      const listed = roleList.instances.find(
        ({ instanceId }) => instanceId === privateBox.instanceId,
      );
      const role = roleList.roles.find(
        ({ roleId }) => roleId === listed?.roleId,
      );
      instance = {
        agentId: listed?.agentId,
        channelId: listed?.channelId,
        handle: agents.agents.find(
          ({ definition }) => definition.agentId === listed?.agentId,
        )?.handle,
        instanceId: privateBox.instanceId,
        roleName: role?.configuration.displayName,
      };
      const entry = activity.agents.find(
        ({ participantId }) => participantId === privateBox.instanceId,
      );
      const records =
        instance.agentId === undefined
          ? []
          : (
              await context.client.request(
                "agent.activity.list",
                { agentId: instance.agentId, limit: 20 },
                { signal },
              )
            ).activities;
      if (signal.aborted) return;
      const agentId = instance.agentId;
      statusBody.replaceChildren(
        ...present(
          field("实例", privateBox.instanceId, "instance-id"),
          field(
            "状态",
            entry === undefined
              ? "不在本私聊的活动列表"
              : stateLabel(entry.state),
            "instance-state",
          ),
          field(
            "排队",
            entry === undefined
              ? "—"
              : entry.queued === undefined
                ? `排队 ${UNKNOWN}`
                : entry.queued
                  ? "排队 1（私聊）"
                  : "排队 0",
            "instance-queued",
          ),
          entry?.lastError === undefined
            ? null
            : field("最近错误", entry.lastError, "last-error"),
          agentId === undefined
            ? el("p", {
                className: "muted",
                text: "实例已不在频道成员列表中，运行记录不可读取",
              })
            : runList(runAttemptsInRoom(records, roomId).slice(0, 5), (run) =>
                runDetail.show(
                  agentId,
                  run.runAttemptId,
                  `私聊 @${instance?.handle ?? privateBox.instanceId}`,
                ),
              ),
        ),
      );
      renderHeader();
      messages.render();
    } catch (error) {
      if (signal.aborted || isAbort(error)) return;
      statusBody.replaceChildren(
        el("p", {
          className: "error",
          text: `实例状态读取失败：${errorText(error)}`,
        }),
      );
    }
  });
  renderHeader();
  const unsubscribe = subscribe(context, () => {
    renderHeader();
    if (instance === undefined && box() !== undefined) poller.runNow();
  });
  poller.start();
  return () => {
    unsubscribe();
    poller.stop();
  };
}
