import { RoomKernel, NotFoundError } from "@rah-os/kernel";
/** Bootstrap reconciliation uses canonical commands; existing Channels and history are untouched. */
export function ensureAllChannel(
  kernel: RoomKernel,
  accessToken: string,
  workspaceId: string,
  controlRoomId: string,
) {
  const actor = kernel.authenticateHumanAccessToken(accessToken);
  try {
    if (kernel.getSystemChannelVisibility(actor, { workspaceId }).hidden)
      return undefined;
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  const existing = kernel
    .listRooms(actor, { workspaceId })
    .find((r) => r.kind === "channel" && r.slug === "all");
  if (existing) {
    if (
      existing.archivedAt ||
      existing.visibility !== "public" ||
      existing.name !== "all"
    )
      throw new Error("Existing #all needs explicit recovery before startup");
    return existing;
  }
  return kernel.createWorkspaceRoom(actor, {
    workspaceId,
    kind: "channel",
    name: "all",
    slug: "all",
    visibility: "public",
    idempotencyKey: "local-workbench-permanent-all-v1",
    basedOnControlRoomSeq: kernel.sync(actor, {
      roomId: controlRoomId,
      consumerId: "bootstrap-all",
    }).latestRoomSeq,
  }).room;
}
