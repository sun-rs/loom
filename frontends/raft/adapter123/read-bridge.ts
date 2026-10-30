import { nativePresence } from "./presence.ts";
import { nativeRuntimeId, nativeRuntimeGroups } from "./runtime-models.ts";
import { nativeMessage } from "./message-projection.ts";
import { readResource } from "./read-resources.ts";
import type { RahClient } from "@rah-os/client-sdk";
import { projectRoleAvatars } from "../loom/role-avatar-projection.ts";
import { nativeAvatarUrl as roleAvatarUrl } from "./avatars.ts";
import { RoomSession } from "@rah-os/client-core";
import { nativeSidebar } from "./sidebar.ts";
import type { SidebarPreferences } from "@rah-os/protocol";
/** Transport DTOs only. Kernel/SDK remain the owner; no native business API leaves the browser. */
export class NativeReadBridge {
  readonly client: RahClient;
  private identities = new Map<string, "role" | "instance">();
  kind(id: string) {
    return this.identities.get(id);
  }
  private epoch = 0;
  invalidate() {
    this.epoch++;
    this.catalogRead = undefined;
  }
  private bootstrap: Promise<any> | undefined;
  private catalogRead: Promise<any> | undefined;
  private channels = new Map<string, { room: RoomSession }>();
  constructor(client: RahClient) {
    this.client = client;
  }
  async sidebarPeers(p: SidebarPreferences) {
    const standalone = new Set(
      p.dmOrder.filter((k) => k.startsWith("room:")).map((k) => k.slice(5)),
    );
    const peers = new Map<string, string>();
    if (!standalone.size) return peers;
    const [rooms, catalog] = await Promise.all([this.rooms(), this.catalog()]);
    for (const room of rooms) {
      if (room.kind !== "channel" || room.side || !standalone.has(room.roomId))
        continue;
      const members = catalog.instances.filter(
        (i: any) => i.channelId === room.roomId,
      );
      if (members.length === 1) peers.set(members[0].instanceId, room.roomId);
    }
    return peers;
  }
  async identity() {
    return (this.bootstrap ??= Promise.all([
      this.client.request("workspace.list", {}),
      this.client.request("principal.me", {}),
    ]).then(([directory, identity]) => {
      const workspace = directory.workspaces.find((w) => w.state === "active");
      if (!workspace?.controlRoomId) throw Error("LOOM_WORKSPACE_UNAVAILABLE");
      const p = identity.principal;
      return {
        workspace,
        user: {
          id: p.principalId,
          name: p.handle,
          displayName: p.displayName ?? p.handle,
          description: null,
          avatarUrl: roleAvatarUrl(p.avatarKey ?? null),
          email: "",
          gravatarHash: "",
          emailVerified: true,
          profileSetupCompletedAt: workspace.createdAt,
          displayLanguage: "zh-CN",
          preferredLanguage: "zh-CN",
          preferredTimezone: null,
          preferredTimeFormat: null,
          preferredMessageBodyFontSize: "md",
        },
        server: {
          id: workspace.workspaceId,
          slug: workspace.slug,
          name: workspace.name,
          role: "owner",
          ownerId: p.principalId,
          createdAt: workspace.createdAt,
        },
      };
    }));
  }
  async catalog() {
    if (this.catalogRead) return this.catalogRead;
    const epoch = this.epoch;
    const current = this.identity()
      .then(({ workspace }) =>
        Promise.all([
          this.client.request("role.list", {
            controlRoomId: workspace.controlRoomId,
          }),
          this.client.request("agent.list", {
            controlRoomId: workspace.controlRoomId,
          }),
          this.client.request("host.runtime.list", {}),
          this.client.request("agent.presence.list", {
            controlRoomId: workspace.controlRoomId,
          }),
        ]),
      )
      .then(([roles, agents, inventory, presence]): any => {
        if (epoch !== this.epoch) return this.catalog();
        this.identities = new Map(
          [...roles.roles, ...(roles.deletedRoles ?? [])].map((r) => [
            r.roleId,
            "role" as const,
          ]),
        );
        for (const i of roles.instances)
          this.identities.set(i.instanceId, "instance");
        return {
          ...roles,
          ...agents,
          inventory,
          presence: presence.agents,
          avatars: projectRoleAvatars(roles, agents.agents),
        };
      });
    this.catalogRead = current;
    try {
      return await current;
    } finally {
      if (this.catalogRead === current) this.catalogRead = undefined;
    }
  }
  async roleRows() {
    const c = await this.catalog();
    return [
      ...c.roles.map((r: any) =>
        this.agentDto(r.roleId, r.configuration, r.createdAt, null, c),
      ),
      ...(c.deletedRoles ?? []).map((r: any) =>
        this.agentDto(
          r.roleId,
          r.configuration,
          r.createdAt,
          r.updatedAt ?? r.createdAt,
          c,
        ),
      ),
    ];
  }
  private agentDto(
    id: string,
    config: any,
    createdAt: string,
    deletedAt: string | null,
    c: any,
  ) {
    const offer = c.inventory.runtimes.find(
      (r: any) => r.runtimeOfferId === config.runtimeOfferId,
    );
    const binding = offer?.modelBindingDescriptors.find((b: any) =>
      config.modelIntent?.exactBindingIds?.includes(b.modelBindingId),
    );
    const group =
      offer?.cliId && binding
        ? nativeRuntimeGroups(c.inventory, offer.cliId).find((g) =>
            g.variants.some((b) => b.modelBindingId === binding.modelBindingId),
          )
        : undefined;
    const model =
      group && group.variants.length > 1
        ? group.value
        : (binding?.modelId ?? "");
    const mode =
      group?.fastBindingIds?.includes(binding?.modelBindingId ?? "") ||
      (config.modelIntent?.serviceTier &&
        config.modelIntent.serviceTier !== "default")
        ? "fast"
        : "default";
    return {
      id,
      name: config.handle ?? config.displayName,
      displayName: config.displayName ?? config.handle,
      description: config.description ?? null,
      avatarUrl: roleAvatarUrl(config.avatarKey ?? null),
      ...nativePresence(
        c.instances
          .filter((i: any) => i.roleId === id)
          .map((i: any) => i.agentId),
        c.presence ?? [],
      ),
      runtime: nativeRuntimeId(offer?.cliId ?? ""),
      model,
      reasoningEffort: config.modelIntent?.reasoning ?? null,
      runtimeConfig:
        offer && binding
          ? {
              version: 1,
              runtime: nativeRuntimeId(offer.cliId),
              model: { kind: "preset", id: model },
              mode: { kind: mode },
              reasoningEffort: config.modelIntent?.reasoning ?? null,
              envVars: config.environment ?? null,
            }
          : null,
      executionMode: "byoc",
      envVars: config.environment ?? null,
      machineId: offer ? c.inventory.hostId : null,
      serverRole: null,
      creatorType: "user",
      creatorId: null,
      creator: null,
      createdAgents: c.instances
        .filter((i: any) => i.roleId === id)
        .flatMap((i: any) => {
          const a = c.agents.find(
            (a: any) => a.definition.agentId === i.agentId,
          );
          if (!a) return [];
          const r = c.inventory.runtimes.find((r: any) =>
            r.agentBindings.some(
              (b: any) =>
                b.agentId === i.agentId && b.participantId === i.instanceId,
            ),
          );
          return [
            {
              id: i.instanceId,
              name: a.handle,
              displayName: a.currentRevision.displayName ?? a.handle,
              avatarUrl: roleAvatarUrl(
                c.avatars[i.instanceId] ?? a.currentRevision.avatarKey ?? null,
              ),
              runtime: r?.cliId ?? "",
              ...nativePresence([a.definition.agentId], c.presence ?? []),
            },
          ];
        }),
      createdAt,
      deletedAt,
    };
  }
  private instanceDto(a: any, c: any, policy?: any) {
    const offer = c.inventory.runtimes.find((r: any) =>
      r.agentBindings?.some(
        (b: any) =>
          b.agentId === a.definition.agentId &&
          b.participantId === a.definition.participantId,
      ),
    );
    const binding = offer?.modelBindingDescriptors.find(
      (b: any) => b.modelBindingId === a.modelBindingId,
    );
    const config = {
      ...a.currentRevision,
      runtimeOfferId: offer?.runtimeOfferId,
      modelIntent: {
        ...(policy?.modelIntent ?? {}),
        exactBindingIds: a.modelBindingId
          ? [a.modelBindingId]
          : policy?.modelIntent?.exactBindingIds,
      },
    };
    return {
      ...this.agentDto(
        a.definition.participantId,
        config,
        a.definition.createdAt,
        a.definition.state === "tombstoned" ? a.definition.updatedAt : null,
        c,
      ),
      name: a.handle,
      model: binding?.modelId ?? "",
      ...nativePresence([a.definition.agentId], c.presence ?? []),
      avatarUrl: roleAvatarUrl(
        c.avatars[a.definition.participantId] ??
          a.currentRevision.avatarKey ??
          null,
      ),
    };
  }
  async agent(id: string) {
    const c = await this.catalog(),
      role = [...c.roles, ...(c.deletedRoles ?? [])].find(
        (r: any) => r.roleId === id,
      );
    if (role)
      return this.agentDto(
        id,
        role.configuration,
        role.createdAt,
        c.roles.some((r: any) => r.roleId === id)
          ? null
          : (role.updatedAt ?? role.createdAt),
        c,
      );
    const a = c.agents.find((a: any) => a.definition.participantId === id);
    if (!a) throw Error("LOOM_AGENT_NOT_FOUND");
    const profile = await this.client.request("agent.get", {
      agentId: a.definition.agentId,
    });
    return this.instanceDto(a, c, profile.policy);
  }
  async rooms() {
    const { workspace } = await this.identity();
    return (
      await this.client.request("room.list", {
        workspaceId: workspace.workspaceId,
      })
    ).rooms;
  }
  channelDto(room: any) {
    return {
      id: room.roomId,
      serverId: room.workspaceId,
      name: room.name,
      description: room.description ?? null,
      type: room.kind === "direct" ? "dm" : "channel",
      createdAt: room.createdAt,
      archivedAt: room.archivedAt ?? null,
      joined: true,
      channelRole: "admin",
      guestVisible: false,
      guestJoinable: false,
      authorityRevision: room.updatedAt,
      systemKey: null,
    };
  }
  channel(id: string) {
    let channel = this.channels.get(id);
    if (!channel) {
      channel = {
        room: new RoomSession({
          client: this.client,
          roomId: id,
          consumerId: "loom-native123-" + id,
        }),
      };
      this.channels.set(id, channel);
    }
    return channel;
  }
  async channelView(id: string) {
    const channel = this.channel(id);
    await channel.room.syncUntilCurrent({ maxPages: 10 });
    return { members: channel.room.state.snapshot?.members ?? [] };
  }
  async messagePage(
    id: string,
    parameters: {
      before?: string | null;
      after?: string | null;
      limit?: string | null;
    } = {},
  ) {
    if (parameters.before && parameters.after)
      throw Error("历史读取不能同时指定两个方向");
    const limit = Math.max(1, Math.min(200, Number(parameters.limit ?? 50)));
    const sequence = (value: string) => {
      const n = Number(value);
      if (!Number.isSafeInteger(n) || n < 0) throw Error("无效的频道消息序号");
      return n;
    };
    const view = await this.channelView(id);
    const page = await this.client.request("room.timeline", {
      roomId: id,
      limit,
      ...(parameters.before ? { beforeSeq: sequence(parameters.before) } : {}),
      ...(parameters.after ? { afterSeq: sequence(parameters.after) } : {}),
    });
    return {
      messages: page.items.map((item) =>
        item.kind === "message"
          ? nativeMessage(item.message, view.members)
          : {
              id: "event:" + item.notice.eventId,
              channelId: item.notice.roomId,
              seq: item.notice.roomSeq,
              senderId: "system",
              senderType: "user",
              messageType: "system",
              content: item.notice.text,
              createdAt: item.notice.createdAt,
            },
      ),
      hasMore: page.hasMoreBefore,
      hasNewer: page.hasMoreAfter,
      historyLimited: false,
    };
  }
  async read(input: string, params: Record<string, unknown> = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const epoch = this.epoch,
        value = await this.readCurrent(input, params);
      if (epoch === this.epoch) return value;
    }
    throw Error("Loom数据已变化，请重新读取");
  }
  private async readCurrent(
    input: string,
    params: Record<string, unknown> = {},
  ) {
    const url = new URL(input, "http://loom.invalid");
    for (const [k, v] of Object.entries(params))
      if (v !== undefined) url.searchParams.set(k, String(v));
    const path = url.pathname;
    const { workspace, user, server } = await this.identity();
    if (path === "/auth/me") return user;
    if (path === "/servers") return [server];
    if (path === `/servers/${server.id}/members`)
      return [{ ...user, userId: user.id, user, role: "owner" }];
    if (path === "/agents") {
      const c = await this.catalog();
      return [
        ...c.roles.map((r: any) =>
          this.agentDto(r.roleId, r.configuration, r.createdAt, null, c),
        ),
        ...(c.deletedRoles ?? []).map((r: any) =>
          this.agentDto(
            r.roleId,
            r.configuration,
            r.createdAt,
            r.updatedAt ?? r.createdAt,
            c,
          ),
        ),
        ...c.agents
          .filter(
            (a: any) => this.kind(a.definition.participantId) === "instance",
          )
          .map((a: any) => this.instanceDto(a, c)),
      ];
    }
    const agent = path.match(/^\/agents\/([^/]+)$/);
    if (agent) return this.agent(agent[1]);
    if (path === "/channels" || path === "/channels/dm") {
      const [rooms, { preferences }] = await Promise.all([
        this.rooms(),
        this.client.request("sidebar.get", {
          workspaceId: workspace.workspaceId,
        }),
      ]);
      const standalone = new Set(
        preferences.dmOrder
          .filter((key) => key.startsWith("room:"))
          .map((key) => key.slice(5)),
      );
      const selected = rooms.filter(
        (r) =>
          r.kind === "channel" &&
          !r.side &&
          (path === "/channels/dm"
            ? standalone.has(r.roomId)
            : !standalone.has(r.roomId)),
      );
      if (path === "/channels") return selected.map((r) => this.channelDto(r));
      if (!selected.length) return [];
      const c = await this.catalog();
      return selected.map((room) => {
        const instance = c.instances.filter(
            (i: any) => i.channelId === room.roomId,
          ),
          a =
            instance.length === 1
              ? c.agents.find(
                  (a: any) => a.definition.agentId === instance[0].agentId,
                )
              : undefined;
        return {
          ...this.channelDto(room),
          type: "dm",
          ...(a
            ? {
                peerType: "agent",
                peerId: instance[0].instanceId,
                peerName: a.handle,
                peerDisplayName: a.currentRevision.displayName ?? a.handle,
                peerAvatarUrl: roleAvatarUrl(
                  c.avatars[instance[0].instanceId] ??
                    a.currentRevision.avatarKey ??
                    null,
                ),
              }
            : {}),
        };
      });
    }
    const resource = await readResource(this, url);
    if (resource) return resource.data;
    const messages = path.match(/^\/messages\/channel\/([^/]+)$/);
    if (messages)
      return this.messagePage(messages[1]!, {
        before: url.searchParams.get("before"),
        after: url.searchParams.get("after"),
        limit: url.searchParams.get("limit"),
      });
    if (path === "/messages/sync") {
      const id = url.searchParams.get("channel_id");
      if (!id)
        throw Error("Loom同步必须指定频道channel_id；不存在全局消息序号");
      return (
        await this.messagePage(id, {
          after: url.searchParams.get("since_seq") ?? "0",
          limit: url.searchParams.get("limit"),
        })
      ).messages;
    }
    const members = path.match(/^\/channels\/([^/]+)\/members$/);
    if (members) {
      const m = (await this.channelView(members[1])).members,
        c = await this.catalog();
      return {
        agents: m
          .filter((p) => p.kind === "agent")
          .flatMap((p) => {
            const a = c.agents.find(
              (a: any) => a.definition.participantId === p.principalId,
            );
            return a ? [this.instanceDto(a, c)] : [];
          }),
        humans: m
          .filter((p) => p.kind === "human")
          .map((p) => ({
            ...user,
            id: p.principalId,
            name: p.handle,
            displayName: p.displayName ?? p.handle,
            avatarUrl: roleAvatarUrl(p.avatarKey ?? null),
            channelRole: "admin",
            role: "owner",
            serverRole: "owner",
          })),
      };
    }
    if (path === `/servers/${server.id}/model-label-catalog`) {
      const c = await this.catalog();
      return {
        machines: {
          [c.inventory.hostId]: {
            runtimes: Object.fromEntries(
              c.inventory.runtimes
                .filter((r: any) => r.cliId)
                .map((r: any) => [
                  r.cliId,
                  {
                    models: r.modelBindingDescriptors.map((b: any) => ({
                      id: b.modelId,
                      label: b.displayName ?? b.modelId,
                    })),
                    updatedAt: r.probeObservedAt ?? workspace.createdAt,
                  },
                ]),
            ),
          },
        },
      };
    }
    if (path === `/servers/${server.id}/machines`) {
      const inventory = await this.client.request("host.runtime.list", {}),
        computer = inventory.computer;
      if (!computer) return [];
      return [
        {
          id: inventory.hostId,
          name: computer.displayName,
          description: computer.description ?? null,
          status: computer.status === "online" ? "online" : "offline",
          statusVersion: computer.profileRevision ?? 0,
          apiKeyPrefix: null,
          runtimes: inventory.runtimes
            .filter((r) => r.available && r.cliId)
            .map((r) => nativeRuntimeId(r.cliId!)),
          runtimeVersions: Object.fromEntries(
            inventory.runtimes
              .filter((r) => r.cliId && r.version)
              .map((r) => [r.cliId, r.version]),
          ),
          hostname: computer.hostname,
          os: computer.os,
          daemonVersion: computer.buildVersion ?? null,
          isComputer: true,
          createdAt: computer.createdAt ?? computer.observedAt,
          lastSeenAt: computer.lastSeenAt ?? computer.observedAt,
        },
      ];
    }
    if (path === `/servers/${server.id}/sidebar-order`) {
      const { preferences: p } = await this.client.request("sidebar.get", {
        workspaceId: workspace.workspaceId,
      });
      return nativeSidebar(p, await this.sidebarPeers(p));
    }
    if (path === `/servers/${server.id}/settings`)
      return {
        settings: { feedbackSettings: { enabled: false }, onboardSettings: {} },
      };
    if (path === "/channels/unread" || path === "/servers/unread-summary") {
      const activity = await this.client.request("activity.list", {
        workspaceId: workspace.workspaceId,
        limit: 1,
      });
      if (!activity.summary) throw Error("LOOM_ACTIVITY_SUMMARY_UNAVAILABLE");
      if (path === "/channels/unread")
        return {
          channels: Object.fromEntries(
            activity.summary.rooms.map((r) => [
              r.roomId,
              {
                unreadCount: r.unreadCount,
                manualUnread: r.markedUnread ?? false,
                hasMention: r.hasMention,
                hasAnyMention: r.hasMention,
              },
            ]),
          ),
        };
      return [
        {
          serverId: server.id,
          unreadCount: activity.summary.rooms.reduce(
            (sum, r) => sum + r.unreadCount,
            0,
          ),
          activityUnreadCount: activity.summary.unreadActivityCount,
          serverPushMuted: (
            await this.client.request("sidebar.get", {
              workspaceId: workspace.workspaceId,
            })
          ).preferences.mutedWorkspace,
        },
      ];
    }
    const room = path.match(/^\/channels\/([^/]+)$/);
    if (room) {
      const row = (await this.rooms()).find((r) => r.roomId === room[1]);
      if (!row) throw Error("LOOM_ROOM_NOT_FOUND");
      return this.channelDto(row);
    }
    throw Error("UNBOUND_NATIVE_READ " + path);
  }
}
