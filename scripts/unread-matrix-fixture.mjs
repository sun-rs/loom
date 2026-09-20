// Isolated Kernel seed only; no real provider run or formal user data.
export function seedUnreadMatrix(kernel, actor, workspace, agents) {
  const head = (roomId) =>
    kernel.sync(actor, { roomId, consumerId: "unread-matrix-seed" })
      .latestRoomSeq;
  const channel = kernel.createWorkspaceRoom(actor, {
    kind: "channel",
    name: "Unread Matrix",
    slug: "unread-matrix",
    workspaceId: workspace.workspace.workspaceId,
    basedOnControlRoomSeq: head(workspace.controlRoom.roomId),
    idempotencyKey: "unread-matrix-room",
  }).room;
  kernel.addMember(actor, {
    roomId: channel.roomId,
    principalId: agents[0].principal.principalId,
  });
  const direct = kernel.openDirectRoom(actor, {
    workspaceId: workspace.workspace.workspaceId,
    peerPrincipalId: agents[0].principal.principalId,
    basedOnControlRoomSeq: head(workspace.controlRoom.roomId),
    idempotencyKey: "unread-matrix-dm",
  });
  for (const room of [channel, direct]) {
    kernel.markHumanActivity(actor, {
      roomId: room.roomId,
      throughSeq: 0,
      action: "read",
      source: "channel-list",
    });
    for (let index = 0; index < 2; index++)
      kernel.postMessage(
        kernel.authenticateAccessToken(agents[0].accessToken),
        {
          roomId: room.roomId,
          body: `FAKE unread message ${index}`,
          recipients: [],
          basedOnRoomSeq: head(room.roomId),
          idempotencyKey: `unread-${room.roomId}-${index}`,
        },
      );
  }
  kernel.addMember(actor, {
    roomId: channel.roomId,
    principalId: agents[1].principal.principalId,
  });
}
