// Isolated real Kernel/HTTP with Fake CLI; never use this helper on formal state.
import assert from "node:assert/strict";
export async function roleBrowserFixture(page, fixture) {
  const post = async (path, data) => {
    const response = await page.request.post(
      `${fixture.origin}/v3/client/${path}`,
      { data },
    );
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const head = async (roomId = workspace.controlRoomId) =>
    (
      await post("rooms/sync", {
        roomId,
        consumerId: "retired-gate",
        bootstrap: "latest",
      })
    ).latestRoomSeq;
  const catalog = () =>
    post("roles/list", { controlRoomId: workspace.controlRoomId });
  const channel = async (name) =>
    (
      await post("rooms/create", {
        workspaceId: workspace.workspaceId,
        basedOnControlRoomSeq: await head(),
        kind: "channel",
        visibility: "public",
        name,
        slug: name.toLowerCase(),
        idempotencyKey: crypto.randomUUID(),
      })
    ).room;
  const createRole = async (name) => {
    const old = (
      await post("agents/list", { controlRoomId: workspace.controlRoomId })
    ).agents[0];
    const detail = await post("agents/get", {
      agentId: old.definition.agentId,
    });
    return (
      await post("roles/create", {
        controlRoomId: workspace.controlRoomId,
        basedOnRoomSeq: await head(),
        idempotencyKey: crypto.randomUUID(),
        configuration: {
          displayName: name,
          handle: name,
          role: "Fake browser fixture",
          instructions: "Isolated Fake CLI only.",
          runtimeOfferId: detail.policy.required.allowedOfferIds[0],
          modelIntent: detail.policy.modelIntent,
          sessionPolicy: "prefer_resume",
        },
      })
    ).role;
  };
  const instantiate = async (role, room) => {
    const input = {
      roleId: role.roleId,
      channelId: room.roomId,
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: crypto.randomUUID(),
    };
    const result = await post("roles/instantiate", input);
    const replay = await post("roles/instantiate", input);
    assert.equal(replay.deduplicated, true);
    assert.equal(replay.instance.instanceId, result.instance.instanceId);
    return result.instance;
  };
  return { post, workspace, head, catalog, channel, createRole, instantiate };
}
export async function selectRoleChannel(page, origin, role, room) {
  await page.goto(`${origin}/?surface=agents`);
  await page
    .getByRole("button", { name: role.configuration.displayName, exact: true })
    .click();
  await page
    .getByRole("button", { name: "加入频道：请选择", exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: room.name, exact: true })
    .click();
}
