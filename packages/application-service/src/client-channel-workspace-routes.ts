import {
  ForbiddenError,
  type HumanApplicationPort,
  type AuthenticatedActorContext,
} from "@rah-os/kernel";
import {
  ChannelWorkspaceReadRequestSchema,
  ChannelWorkspaceReadResponseSchema,
  type ChannelWorkspace,
  type ChannelWorkspaceReadRequest,
  type ChannelWorkspaceReadResponse,
} from "@rah-os/protocol";
export type ChannelWorkspaceReadPort = (
  workspace: ChannelWorkspace,
  input: ChannelWorkspaceReadRequest,
) => Promise<ChannelWorkspaceReadResponse>;
export async function routeChannelWorkspace(
  human: HumanApplicationPort,
  actor: AuthenticatedActorContext,
  body: unknown,
  port: ChannelWorkspaceReadPort | undefined,
) {
  const input = ChannelWorkspaceReadRequestSchema.parse(body);
  const authorize = () => {
    const room = human.listRooms(actor).find((r) => r.roomId === input.roomId);
    if (!room?.channelWorkspace || room.instancePrivateBox)
      throw new ForbiddenError("Channel workspace access unavailable");
    return room.channelWorkspace;
  };
  const workspace = authorize();
  if (!port) throw new Error("此 Computer 尚未提供频道工作区读取能力");
  const result = await port(workspace, input);
  if (JSON.stringify(authorize()) !== JSON.stringify(workspace))
    throw new ForbiddenError("Channel workspace access changed during read");
  return ChannelWorkspaceReadResponseSchema.parse(result);
}
