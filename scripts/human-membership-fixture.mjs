// Disposable fake-provider fixture only. Never imported by a product owner.
export function seedHumanMembershipFixture(kernel, owner, workspace, roomId) {
  const latest = (id) =>
    kernel.sync(owner, {
      roomId: id,
      consumerId: `human-fixture-${id}`,
    }).latestRoomSeq;
  for (const [handle, role] of [
    ["fixture-coowner", "owner"],
    ["fixture-colleague", "member"],
  ]) {
    const person = kernel.provisionPrincipal({ handle, kind: "human" });
    const actor = kernel.authenticateHumanAccessToken(person.accessToken);
    kernel.updateAuthenticatedPrincipal(actor, {
      avatarKey: null,
      displayName:
        handle === "fixture-colleague"
          ? "Fixture colleague / 多语言长名称 ".repeat(4)
          : "Fixture co-owner",
    });
    for (const id of [workspace.controlRoom.roomId, roomId])
      kernel.addRoomMember(owner, {
        basedOnRoomSeq: latest(id),
        idempotencyKey: `seed-${handle}-${id}`,
        principalId: person.principal.principalId,
        role,
        roomId: id,
      });
  }
}
