import { RoomSession } from "@rah-os/client-core";
import {
  WriteIntentSlot,
  type IntentOutcome,
} from "@rah-os/client-core/write-intent";
import type { RahClient } from "@rah-os/client-sdk";
import type {
  ClientRoomMutationResponse,
  RoleTemplate,
  RoleCreateRequest,
  RoleListResponse,
  SidebarPatchRequest,
} from "@rah-os/protocol";
type Done = (result: IntentOutcome<unknown>) => void;
export class ManagementClient {
  readonly writes = new WriteIntentSlot();
  readonly client: RahClient;
  readonly workspaceId: string;
  readonly controlRoomId: string;
  readonly control: RoomSession;
  constructor(client: RahClient, workspaceId: string, controlRoomId: string) {
    this.client = client;
    this.workspaceId = workspaceId;
    this.controlRoomId = controlRoomId;
    this.control = this.session(controlRoomId);
  }
  session(roomId: string) {
    return new RoomSession({
      client: this.client,
      roomId,
      consumerId: `loom-management-${roomId}`,
    });
  }
  async catalog() {
    const [roles, agents, rooms] = await Promise.all([
      this.client.request("role.list", { controlRoomId: this.controlRoomId }),
      this.client.request("agent.list", { controlRoomId: this.controlRoomId }),
      this.client.request("room.list", { workspaceId: this.workspaceId }),
    ]);
    return { ...roles, ...agents, ...rooms };
  }
  save(
    configuration: RoleCreateRequest["configuration"],
    role: RoleTemplate | undefined,
    done: Done,
  ) {
    return this.writes.submit({
      action: role ? "role-revise" : "role-create",
      session: this.control,
      payload: {
        configuration,
        ...(role
          ? { roleId: role.roleId, expectedRoleRevisionId: role.roleRevisionId }
          : { controlRoomId: this.controlRoomId }),
      },
      send: (p, basedOnRoomSeq, idempotencyKey) =>
        "roleId" in p
          ? this.client.request("role.revise", {
              configuration: p.configuration,
              roleId: p.roleId!,
              expectedRoleRevisionId: p.expectedRoleRevisionId!,
              basedOnRoomSeq,
              idempotencyKey,
            })
          : this.client.request("role.create", {
              configuration: p.configuration,
              controlRoomId: this.controlRoomId,
              basedOnRoomSeq,
              idempotencyKey,
            }),
      onSettled: done,
    });
  }
  restoreRole(role: RoleTemplate, displayName: string, done: Done) {
    return this.writes.submit({
      action: "role-restore",
      session: this.control,
      payload: {
        roleId: role.roleId,
        expectedRoleRevisionId: role.roleRevisionId,
        displayName,
      },
      send: (payload, basedOnRoomSeq, idempotencyKey) =>
        this.client.request("role.restore", {
          ...payload,
          basedOnRoomSeq,
          idempotencyKey,
        }),
      onSettled: done,
    });
  }
  deleteRole(role: RoleTemplate, done: Done) {
    return this.writes.submit({
      action: "role-delete",
      session: this.control,
      payload: {
        roleId: role.roleId,
        expectedRoleRevisionId: role.roleRevisionId,
      },
      send: (p, basedOnRoomSeq, idempotencyKey) =>
        this.client.request("role.delete", {
          ...p,
          basedOnRoomSeq,
          idempotencyKey,
        }),
      onSettled: done,
    });
  }
  instance(
    action: "add" | "remove" | "restart",
    channelId: string,
    id: string,
    done: Done,
    adoptRoleRevisionId?: string,
  ) {
    return this.writes.submit({
      action:
        action === "add"
          ? "instantiate"
          : action === "remove"
            ? "instance-remove"
            : "session-reset",
      session: this.session(channelId),
      payload: {
        channelId,
        id,
        ...(adoptRoleRevisionId ? { adoptRoleRevisionId } : {}),
      },
      send: (p, basedOnRoomSeq, idempotencyKey) =>
        action === "add"
          ? this.client.request("role.instantiate", {
              roleId: p.id,
              channelId: p.channelId,
              basedOnRoomSeq,
              idempotencyKey,
            })
          : action === "remove"
            ? this.client.request("room.member.remove", {
                roomId: p.channelId,
                principalId: p.id,
                basedOnRoomSeq,
                idempotencyKey,
              })
            : this.client.request("instance.session.reset", {
                instanceId: p.id,
                ...(p.adoptRoleRevisionId
                  ? { adoptRoleRevisionId: p.adoptRoleRevisionId }
                  : {}),
                basedOnRoomSeq,
                idempotencyKey,
              }),
      onSettled: done,
    });
  }
  setEnabled(agentId: string, enabled: boolean, done: Done) {
    return this.writes.submit({
      action: "agent-state",
      session: this.control,
      payload: {
        agentId,
        action: "set_state" as const,
        state: enabled ? ("enabled" as const) : ("disabled" as const),
      },
      send: (payload, basedOnRoomSeq, idempotencyKey) =>
        this.client.request("agent.manage", {
          ...payload,
          basedOnRoomSeq,
          idempotencyKey,
        }),
      onSettled: done,
    });
  }
  sidebar(
    patch: SidebarPatchRequest["patch"],
    expectedVersion: number,
    done: Done,
  ) {
    return this.writes.submitRevisioned({
      action: "sidebar-patch",
      payload: { workspaceId: this.workspaceId, patch, expectedVersion },
      send: (p, idempotencyKey) =>
        this.client.request("sidebar.patch", { ...p, idempotencyKey }),
      onSettled: done,
    });
  }
  archive(roomId: string, archived: boolean, done: Done) {
    return this.writes.submit({
      action: archived ? "channel-archive" : "channel-unarchive",
      session: this.session(roomId),
      payload: { roomId },
      send: (p, basedOnRoomSeq, idempotencyKey) =>
        this.client.request(archived ? "room.archive" : "room.unarchive", {
          ...p,
          basedOnRoomSeq,
          idempotencyKey,
        }),
      onSettled: done,
    });
  }
  createChannel(
    name: string,
    additionalDirectories: string[],
    done: (result: IntentOutcome<ClientRoomMutationResponse>) => void,
    description?: string,
  ) {
    return this.writes.submit({
      action: "channel-create",
      session: this.control,
      payload: {
        workspaceId: this.workspaceId,
        name,
        slug: `channel-${crypto.randomUUID()}`,
        kind: "channel" as const,
        additionalDirectories,
        ...(description ? { description } : {}),
      },
      send: (p, basedOnControlRoomSeq, idempotencyKey) =>
        this.client.request("room.create", {
          ...p,
          basedOnControlRoomSeq,
          idempotencyKey,
        }),
      onSettled: done,
    });
  }
}
export type Catalog = Awaited<ReturnType<ManagementClient["catalog"]>>;
export type Instance = RoleListResponse["instances"][number];
