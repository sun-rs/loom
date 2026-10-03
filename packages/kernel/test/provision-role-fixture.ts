import { RoleConfigurationSchema } from "@rah-os/protocol";
import type { RoomKernel } from "../src/index.ts";

/** Test-only composition through real Role commands, never inserts projection rows.
 * Returns the instance's control-Room provision receipt for profile tests whose
 * subsequent commands belong to that Room (instantiate's event belongs to the Channel).
 */
export function provisionRoleFixture(
  kernel: RoomKernel,
  actor: Parameters<RoomKernel["roles"]["create"]>[0],
  request: Parameters<RoomKernel["provisionWorkspaceAgent"]>[1],
  channelId?: string,
) {
  const { controlRoomId, basedOnRoomSeq, idempotencyKey, ...configuration } =
    request;
  const role = kernel.roles.create(actor, {
    controlRoomId,
    basedOnRoomSeq,
    idempotencyKey,
    configuration: RoleConfigurationSchema.parse(configuration),
  });
  const head = (roomId: string) =>
    kernel.sync(actor, {
      roomId,
      afterSeq: 0,
      consumerId: "role-fixture",
    }).latestRoomSeq;
  if (!channelId) {
    const workspace = kernel
      .listWorkspaces(actor)
      .find((item) => item.controlRoomId === controlRoomId);
    if (!workspace) throw new Error("Role fixture requires its workspace");
    channelId = kernel.createWorkspaceRoom(actor, {
      workspaceId: workspace.workspaceId,
      basedOnControlRoomSeq: role.event.roomSeq,
      name: configuration.displayName,
      slug: `fixture-${configuration.handle}`,
      kind: "channel",
      idempotencyKey: `${idempotencyKey}-channel`,
    }).room.roomId;
  }
  // A separate key freezes the first instantiation sequence across replays.
  const previous = kernel
    .sync(actor, {
      roomId: channelId,
      afterSeq: 0,
      consumerId: "role-fixture-events",
    })
    .events.find(
      (event) =>
        event.type === "instance.created" &&
        event.idempotencyKey === `${idempotencyKey}-instance`,
    );
  const instance = kernel.roles.instantiate(actor, {
    roleId: role.role.roleId,
    channelId,
    basedOnRoomSeq: previous ? previous.roomSeq - 2 : head(channelId),
    idempotencyKey: `${idempotencyKey}-instance`,
  });
  const detail = kernel.getWorkspaceAgentManagementView(
    actor,
    instance.agent.definition.agentId,
  );
  const event = kernel
    .sync(actor, {
      roomId: controlRoomId,
      afterSeq: 0,
      consumerId: "role-fixture-receipt",
    })
    .events.find(
      (event) =>
        event.type === "agent.provisioned" &&
        event.aggregateId === instance.agent.definition.agentId,
    );
  if (!event)
    throw new Error("Role fixture missing canonical provision receipt");
  return {
    ...detail,
    event,
    deduplicated: instance.deduplicated,
    instance: instance.instance,
  };
}
