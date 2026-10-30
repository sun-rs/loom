import { nativeRuntimeId, nativeRuntimeModels } from "./runtime-models.ts";
import { taskWorkflowStatus } from "@rah-os/protocol";
import { nativeAvatarUrl as roleAvatarUrl } from "./avatars.ts";
import type { NativeReadBridge } from "./read-bridge.ts";
export async function readResource(
  bridge: NativeReadBridge,
  url: URL,
): Promise<{ data: unknown } | undefined> {
  const path = url.pathname,
    { workspace, user, server } = await bridge.identity(),
    client = bridge.client;
  const limit = Math.max(
    1,
    Math.min(100, Number(url.searchParams.get("limit") ?? 30)),
  );
  const conversationPrefs = path.match(
    /^\/channels\/([^/]+)\/(notification-settings|message-display-settings)$/,
  );
  if (
    conversationPrefs ||
    path === `/servers/${server.id}/notification-settings`
  ) {
    const { preferences: p } = await client.request("sidebar.get", {
      workspaceId: workspace.workspaceId,
    });
    if (!conversationPrefs)
      return {
        data: { serverPushMuted: p.mutedWorkspace, prefsVersion: p.version },
      };
    const room = (await bridge.rooms()).find(
      (r) => r.roomId === conversationPrefs[1],
    );
    if (!room) throw Error("未知频道");
    const key = "room:" + room.roomId;
    return {
      data:
        conversationPrefs[2] === "message-display-settings"
          ? {
              collapseLongMessages: !p.expandedLongMessages.includes(key),
              prefsVersion: p.version,
            }
          : {
              activityMuted: p.mutedActivity.includes(key),
              activityMuteSupported: room.kind === "channel" && !room.side,
              muteFromSeq: null,
              prefsVersion: p.version,
            },
    };
  }
  if (
    path === "/announcements/active" ||
    path === "/channels/joint-invites" ||
    path === "/product-feedback/tickets"
  )
    return { data: [] }; // Explicitly absent Raft services, not Loom business resources.
  if (path === "/product-events/config")
    return { data: { clientEventsAllowed: false } };
  if (path === `/servers/${server.id}/translation-settings`)
    return {
      data: {
        translationEnabled: false,
        translationAvailable: false,
        canManageTranslation: false,
      },
    };
  if (path === `/servers/${server.id}/setup-projection`)
    return {
      data: {
        surface: "none",
        phase: null,
        currentStep: null,
        blocksChat: false,
        allowedExits: [],
        sideEffectState: { transitions: "disabled", completion: "disabled" },
        gateReason: null,
      },
    }; // Local Loom owns installation; no Raft onboarding state exists.
  const machineOptions = path.match(
      /^\/servers\/([^/]+)\/machines\/([^/]+)\/runtime-options$/,
    ),
    agentOptions = path.match(/^\/agents\/([^/]+)\/runtime-options$/);
  if (machineOptions || agentOptions) {
    const c = await bridge.catalog();
    if (
      machineOptions &&
      (machineOptions[1] !== server.id ||
        machineOptions[2] !== c.inventory.hostId)
    )
      throw Error("未知计算机");
    if (agentOptions && !bridge.kind(agentOptions[1]!))
      throw Error("未知Role或实例");
    return {
      data: {
        context: machineOptions ? "new_agent" : "existing_agent",
        machineId: c.inventory.hostId,
        options: c.inventory.runtimes
          .filter((r: any) => r.available && r.runtimeOfferId && r.cliId)
          .map((r: any) => ({
            runtimeId: nativeRuntimeId(r.cliId),
            capabilityStatus: "available",
            admissionStatus: "available_for_new",
            admissionReason: null,
            current: false,
            availableForNew: true,
            manageableForCurrentAgent: true,
            canSelectInThisContext: true,
          })),
      },
    };
  }
  const runtimeModels = path.match(
    /^\/servers\/([^/]+)\/machines\/([^/]+)\/runtime-models\/([^/]+)$/,
  );
  if (runtimeModels) {
    if (runtimeModels[1] !== server.id) throw Error("未知工作区");
    return {
      data: nativeRuntimeModels(
        (await bridge.catalog()).inventory,
        runtimeModels[2]!,
        runtimeModels[3]!,
      ),
    };
  }
  if (path === "/channels/saved") {
    if (Number(url.searchParams.get("offset") ?? 0) !== 0)
      throw Error("NATIVE_CURSOR_ADAPTER_NOT_READY");
    const r = await client.request("message.saved", {
      workspaceId: workspace.workspaceId,
      limit,
      query: url.searchParams.get("q") ?? undefined,
      sortDirection: url.searchParams.get("sort") === "asc" ? "asc" : "desc",
      channelId: url.searchParams.get("channelId") ?? undefined,
    });
    const c = await bridge.catalog();
    return {
      data: {
        saved: r.items.map((row) => ({
          messageId: row.message.messageId,
          channelId: row.message.roomId,
          channelName: row.roomName,
          channelType: row.message.threadId
            ? "thread"
            : row.roomKind === "direct"
              ? "dm"
              : "channel",
          content: row.message.body,
          senderType: row.sender.kind === "agent" ? "agent" : "user",
          senderId: row.message.actorId,
          senderName: row.senderName,
          senderAvatarUrl: roleAvatarUrl(
            c.avatars[row.message.actorId] ?? row.sender.avatarKey ?? null,
          ),
          createdAt: row.message.createdAt,
          savedAt: row.savedAt,
          parentChannelId: row.message.threadId ? row.message.roomId : null,
          parentChannelName: row.message.threadId ? row.roomName : null,
          parentChannelType: row.message.threadId
            ? row.roomKind === "direct"
              ? "dm"
              : "channel"
            : null,
          parentMessageId: row.rootMessageId ?? null,
        })),
        total: r.total,
        globalTotal: r.globalTotal,
        hasMore: !!r.nextCursor,
      },
    };
  }
  if (path === "/channels/inbox") {
    if (Number(url.searchParams.get("offset") ?? 0) !== 0)
      throw Error("NATIVE_CURSOR_ADAPTER_NOT_READY");
    const filter = url.searchParams.get("filter") ?? "all";
    if (!["all", "unread", "mentions", "pinned"].includes(filter))
      throw Error("NATIVE_FILTER_UNBOUND");
    const r = await client.request("activity.list", {
      workspaceId: workspace.workspaceId,
      limit,
      filter: filter as any,
    });
    const c = await bridge.catalog();
    const agents = new Set(
      c.agents.map((a: any) => a.definition.participantId),
    );
    return {
      data: {
        items: r.items.map((item) =>
          item.kind === "thread"
            ? {
                kind: "thread",
                threadChannelId: item.threadId,
                parentMessageId: item.rootMessageId,
                parentChannelId: item.roomId,
                parentChannelName: item.roomName,
                parentChannelType: "channel",
                parentMessagePreview: item.title,
                latestActivityPreview: item.latestMessage.body,
                latestActivitySenderType: agents.has(item.latestMessage.actorId)
                  ? "agent"
                  : "user",
                latestActivitySenderId: item.latestMessage.actorId,
                latestActivitySenderName: item.senderName,
                latestActivityMessageId: item.latestMessage.messageId,
                latestActivitySeq: String(item.latestSeq),
                doneFrontierSeq: String(item.latestSeq),
                replyCount: item.replyCount,
                lastActivityAt: item.latestMessage.createdAt,
                lastReplyAt: item.latestMessage.createdAt,
                unreadCount: item.unreadCount,
                hasMention: item.hasMention,
              }
            : {
                kind: item.kind === "direct" ? "dm" : "channel",
                channelId: item.roomId,
                channelName: item.roomName,
                channelType: item.kind === "direct" ? "dm" : "channel",
                lastMessageId: item.latestMessage.messageId,
                latestActivitySeq: String(item.latestSeq),
                doneFrontierSeq: String(item.latestSeq),
                firstUnreadMessageId: null,
                firstMentionMessageId: null,
                lastMessageAt: item.latestMessage.createdAt,
                lastMessagePreview: item.latestMessage.body,
                lastMessageSenderType: agents.has(item.latestMessage.actorId)
                  ? "agent"
                  : "user",
                lastMessageSenderId: item.latestMessage.actorId,
                lastMessageSenderName: item.senderName,
                unreadCount: item.unreadCount,
                hasMention: item.hasMention,
              },
        ),
        totalCount: r.total,
        unreadCount: r.summary?.unreadActivityCount,
        totalUnreadCount: r.summary?.unreadActivityCount,
        hasMore: !!r.nextCursor,
      },
    };
  }
  const tasks = path.match(/^\/tasks\/channel\/([^/]+)$/);
  if (path === "/tasks/server" || tasks) {
    const r = await client.request("task.global.list", {
      workspaceId: workspace.workspaceId,
      limit,
      ...(tasks ? { roomIds: [tasks[1]] } : {}),
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    const dto = r.tasks.map(({ task: t, roomName }) => ({
      id: t.taskId,
      messageId: t.sourceMessageId,
      channelId: t.roomId,
      channelName: roomName,
      channelType: "channel",
      taskNumber: t.taskNumber,
      title: t.title,
      description: t.description ?? null,
      status: taskWorkflowStatus(t.state),
      createdById: t.creatorId,
      createdByType: t.creatorId === user.id ? "user" : "agent",
      claimedById: t.assigneeId ?? null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      completedAt: t.completedAt ?? null,
    }));
    return {
      data: { tasks: dto, next_cursor: r.nextCursor ?? null, total: r.total },
    };
  }
  return undefined;
}
