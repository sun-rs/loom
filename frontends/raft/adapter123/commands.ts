import { openRoleConversation } from "./conversations.ts";
import { nativeRandomAvatar } from "./avatars.ts";
import { type RoomMutationSequenceSession } from "@rah-os/client-core";
import {
  WriteIntentSlot,
  type IntentSpec,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
import { RahClientError } from "@rah-os/client-sdk";
import { nativeSidebar, sidebarPatch } from "./sidebar.ts";
import { MessageSchema, type SidebarPreferences } from "@rah-os/protocol";
import type { NativeReadBridge } from "./read-bridge.ts";
import { nativeMessage } from "./message-projection.ts";
import { nativeRoleConfiguration } from "./role-config.ts";
import { managementCommand } from "./management-commands.ts";
export class NativeCommands {
  readonly writes = new WriteIntentSlot();
  readonly bridge: NativeReadBridge;
  private session: (id: string) => RoomMutationSequenceSession;
  notice: (message: string, retry?: () => Promise<unknown>) => void = () => {};
  changed: (action: string) => void = () => {};
  private projectionRetry: (() => Promise<unknown>) | undefined;
  constructor(
    bridge: NativeReadBridge,
    session?: (id: string) => RoomMutationSequenceSession,
  ) {
    this.bridge = bridge;
    this.session = session ?? ((id) => bridge.channel(id).room);
    this.writes.onChange((state) => {
      if (state === "unknown")
        this.notice(
          "结果未确认，提交保持暂停。请核实原请求；不会自动重发。",
          () => this.verify(),
        );
    });
  }
  verify() {
    return this.projectionRetry ? this.projectionRetry() : this.writes.retry();
  }
  private present<T>(
    read: () => Promise<T>,
    message = "操作已保存，展示数据尚未读到。请重新读取；不会重复写入。",
  ): Promise<T> {
    return read().catch(
      () =>
        new Promise<T>((resolve) => {
          const retry = async () => {
            try {
              const value = await read();
              this.projectionRetry = undefined;
              resolve(value);
              return value;
            } catch {
              this.notice(message, retry);
            }
          };
          this.projectionRetry = retry;
          this.notice(message, retry);
        }),
    );
  }
  observe<T>(read: () => Promise<T>, message?: string) {
    return this.present(read, message);
  }
  private perform<Payload, Result>(
    spec: Omit<IntentSpec<Payload, Result>, "onSettled">,
  ): Promise<Result> {
    return this.settle(spec.action, (onSettled) =>
      this.writes.submit({ ...spec, onSettled }),
    );
  }
  private settle<Result>(
    action: string,
    submit: (
      onSettled: (outcome: IntentOutcome<Result>) => void,
    ) => Promise<unknown>,
  ): Promise<Result> {
    if (this.writes.state !== "idle" || this.projectionRetry)
      return Promise.reject(Error("仍在处理上一项操作，请先核实结果。"));
    return new Promise((resolve, reject) => {
      void submit((outcome) => {
        if (outcome.kind === "ok") {
          this.bridge.invalidate?.();
          this.changed(action);
          resolve(outcome.result);
        } else if (outcome.kind === "rejected") reject(outcome.error);
        else if (outcome.kind === "busy") reject(Error("仍在处理上一项操作"));
      }).catch(reject);
    });
  }
  mutate<Payload, Result>(
    action: string,
    roomId: string,
    payload: Payload,
    send: IntentSpec<Payload, Result>["send"],
  ) {
    return this.perform({
      action,
      session: this.session(roomId),
      payload,
      send,
    });
  }
  async preferences(
    expectedVersion: number,
    build: (p: SidebarPreferences) => Record<string, unknown>,
  ) {
    const { workspace } = await this.bridge.identity();
    const { preferences } = await this.bridge.client.request("sidebar.get", {
      workspaceId: workspace.workspaceId,
    });
    if (
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion !== preferences.version
    )
      throw new RahClientError(
        "stale_sidebar",
        "偏好已更新，请重新读取后操作。",
        409,
      );
    const result = await this.settle<{ preferences: SidebarPreferences }>(
      "sidebar",
      (onSettled) =>
        this.writes.submitRevisioned({
          action: "sidebar",
          payload: {
            workspaceId: workspace.workspaceId,
            expectedVersion,
            patch: build(preferences),
          },
          send: (p, idempotencyKey) =>
            this.bridge.client.request("sidebar.patch", {
              ...p,
              idempotencyKey,
            } as any),
          onSettled,
        }),
    );
    return result.preferences;
  }
  async write(method: string, path: string, input: any = {}) {
    if (this.writes.state !== "idle" || this.projectionRetry)
      throw Error("仍在处理上一项操作，请先核实结果。");
    const { workspace, user, server } = await this.bridge.identity(),
      client = this.bridge.client;
    if (method === "post" && path === "/channels/dm")
      return openRoleConversation(this, input);
    const managed = await managementCommand(this, method, path, input);
    if (managed) return managed.data;
    if (method === "patch" && path === `/servers/${server.id}/sidebar-order`) {
      const { preferences } = await client.request("sidebar.get", {
        workspaceId: workspace.workspaceId,
      });
      const expectedVersion = input.loomPrefsVersion ?? input.sectionsVersion;
      if (
        !Number.isInteger(expectedVersion) ||
        expectedVersion !== preferences.version
      )
        throw new RahClientError(
          "stale_sidebar",
          "列表已更新，请重新读取后操作。",
          409,
        );
      const peers = await this.bridge.sidebarPeers(preferences);
      const patch = sidebarPatch(input, preferences, peers);
      const result = await this.settle<{ preferences: SidebarPreferences }>(
        "sidebar",
        (onSettled) =>
          this.writes.submitRevisioned({
            action: "sidebar",
            payload: {
              workspaceId: workspace.workspaceId,
              expectedVersion,
              patch,
            },
            send: (payload, idempotencyKey) =>
              client.request("sidebar.patch", { ...payload, idempotencyKey }),
            onSettled,
          }),
      );
      return nativeSidebar(result.preferences, peers);
    }
    const viewport = path.match(/^\/channels\/([^/]+)\/read$/);
    if (method === "post" && viewport) {
      return client.request("activity.mark", {
        roomId: viewport[1]!,
        throughSeq: Number(input.seq),
        action: "read",
        source: "viewport",
      });
    }
    if (method === "post" && path === "/v2/messages") {
      const roomId = input.channelId,
        session = this.session(roomId);
      if (input.asTask && input.attachmentIds?.length)
        throw Error("任务创建暂不同时提交附件");
      const result: any = input.asTask
        ? await this.perform({
            action: "task-create",
            session,
            payload: { roomId, title: input.content, dependencyTaskIds: [] },
            send: (p, basedOnRoomSeq, idempotencyKey) =>
              client.request("task.create", {
                ...p,
                basedOnRoomSeq,
                idempotencyKey,
              }),
          })
        : await this.perform({
            action: "message",
            session,
            payload: {
              roomId,
              body: input.content,
              recipients: [],
              ...(input.attachmentIds?.length
                ? { attachmentIds: input.attachmentIds }
                : {}),
            },
            send: (p, basedOnRoomSeq, idempotencyKey) =>
              client.request("message.post", {
                ...p,
                basedOnRoomSeq,
                idempotencyKey,
              }),
          });
      const projected = await this.present(async () => {
        const message = input.asTask
          ? (
              await client.request("message.context", {
                roomId,
                messageId: result.task.sourceMessageId,
              })
            ).message
          : MessageSchema.parse({
              messageId: result.event.payload.messageId,
              body: result.event.payload.body,
              actorId: result.event.actorId,
              roomId: result.event.roomId,
              roomSeq: result.event.roomSeq,
              createdAt: result.event.createdAt,
              ...(result.event.payload.attachments
                ? { attachments: result.event.payload.attachments }
                : {}),
              ...(result.event.payload.mentions
                ? { mentions: result.event.payload.mentions }
                : {}),
            });
        return nativeMessage(message, [
          {
            principalId: user.id,
            handle: user.name,
            displayName: user.displayName,
            kind: "human",
          },
        ]);
      });
      return {
        message: projected,
        pendingMentionActions: [],
        unresolvedMentionHandles: [],
      };
    }
    if (method === "patch" && /^\/agents\/[^/]+$/.test(path)) {
      const id = path.split("/")[2]!,
        c = await this.bridge.catalog(),
        role = c.roles.find((r: any) => r.roleId === id);
      if (!role)
        throw Error("实例配置必须通过显式重启选择修订；不能当作Role直接编辑");
      if (
        input.loomExpectedRoleRevisionId &&
        input.loomExpectedRoleRevisionId !== role.roleRevisionId
      )
        throw new RahClientError(
          "stale_role",
          "角色配置已更新，请重新打开编辑器。",
          409,
        );
      const configuration = nativeRoleConfiguration(
        input,
        c.inventory,
        role.configuration,
      );
      await this.perform({
        action: "role-revise",
        session: this.session(workspace.controlRoomId),
        payload: {
          roleId: id,
          expectedRoleRevisionId: role.roleRevisionId,
          configuration,
        },
        send: (p, basedOnRoomSeq, idempotencyKey) =>
          client.request("role.revise", {
            ...p,
            basedOnRoomSeq,
            idempotencyKey,
          }),
      });
      return this.present(() => this.bridge.agent(id));
    }
    if (method === "post" && path === "/agents") {
      const c = await this.bridge.catalog(),
        configuration = nativeRoleConfiguration(
          {
            ...input,
            avatarUrl: nativeRandomAvatar(
              c.roles.map((r: any) => r.configuration.avatarKey),
            ),
          },
          c.inventory,
        );
      const result = await this.perform({
        action: "role-create",
        session: this.session(workspace.controlRoomId),
        payload: { controlRoomId: workspace.controlRoomId, configuration },
        send: (p, basedOnRoomSeq, idempotencyKey) =>
          client.request("role.create", {
            ...p,
            basedOnRoomSeq,
            idempotencyKey,
          }),
      });
      return this.present(() => this.bridge.agent(result.role.roleId));
    }
    if (method === "post" && path === "/channels") {
      if (
        input.jointInvites?.length ||
        input.invitedPeople?.length ||
        input.userIds?.some((id: string) => id !== user.id)
      )
        throw Error("Loom仅支持当前Human与本地实例频道");
      const result = await this.perform({
        action: "channel-create",
        session: this.session(workspace.controlRoomId),
        payload: {
          workspaceId: workspace.workspaceId,
          name: input.name,
          description: input.description ?? undefined,
          kind: "channel" as const,
          slug: "channel-" + crypto.randomUUID(),
          additionalDirectories: input.additionalDirectories ?? [],
        },
        send: (p, basedOnControlRoomSeq, idempotencyKey) =>
          client.request("room.create", {
            ...p,
            basedOnControlRoomSeq,
            idempotencyKey,
          }),
      });
      for (const roleId of input.agentIds ?? []) {
        try {
          await this.perform({
            action: "instantiate",
            session: this.session(result.room.roomId),
            payload: { roleId, channelId: result.room.roomId },
            send: (p, basedOnRoomSeq, idempotencyKey) =>
              client.request("role.instantiate", {
                ...p,
                basedOnRoomSeq,
                idempotencyKey,
              }),
          });
        } catch {
          this.notice(
            "频道已创建，部分成员未加入。请在此频道成员页继续添加；不要重建频道。",
          );
          break;
        }
      }
      return this.bridge.channelDto(result.room);
    }
    const add = path.match(/^\/channels\/([^/]+)\/agents$/);
    if (method === "post" && add) {
      const result = await this.perform({
        action: "instantiate",
        session: this.session(add[1]!),
        payload: { roleId: input.agentId, channelId: add[1]! },
        send: (p, basedOnRoomSeq, idempotencyKey) =>
          client.request("role.instantiate", {
            ...p,
            basedOnRoomSeq,
            idempotencyKey,
          }),
      });
      return this.present(() => this.bridge.agent(result.instance.instanceId));
    }
    throw Error("UNBOUND_NATIVE_WRITE " + method + " " + path);
  }
}
