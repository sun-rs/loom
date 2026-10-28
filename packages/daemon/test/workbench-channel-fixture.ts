import { RoomKernel } from "@rah-os/kernel";
import { join } from "node:path";
import { prepareLocalWorkbench as prepareProductWorkbench } from "../src/local-workbench-bootstrap.ts";
/** Opt-in test fixture; product bootstrap deliberately creates no Channels. */
export async function prepareLocalWorkbench(
  input: Parameters<typeof prepareProductWorkbench>[0],
) {
  const prepared = await prepareProductWorkbench(input);
  const kernel = new RoomKernel({
    databasePath: join(input.stateDirectory, "room.db"),
  });
  kernel.initialize();
  try {
    const actor = kernel.authenticateHumanAccessToken(
      prepared.humanAccessToken,
    );
    const existing = kernel
      .listRooms(actor, { workspaceId: prepared.metadata.workspaceId })
      .find((r) => r.kind === "channel");
    const room =
      existing ??
      kernel.createWorkspaceRoom(actor, {
        workspaceId: prepared.metadata.workspaceId,
        basedOnControlRoomSeq: kernel.sync(actor, {
          roomId: prepared.metadata.controlRoomId,
          consumerId: "gate-fixture",
        }).latestRoomSeq,
        idempotencyKey: "gate-fixture-channel",
        kind: "channel",
        name: "Gate fixture",
        slug: "gate-fixture",
      }).room;
    return {
      ...prepared,
      metadata: { ...prepared.metadata, defaultRoomId: room.roomId },
    };
  } finally {
    kernel.close();
  }
}
