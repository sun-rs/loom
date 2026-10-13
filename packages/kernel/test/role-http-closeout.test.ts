import assert from "node:assert/strict";
import test from "node:test";
import { ClientApplicationService } from "../../application-service/src/index.ts";
import { HttpRahClient } from "../../client-sdk/src/index.ts";
import { createHumanApplicationPort } from "../src/index.ts";
import { roleInstanceFixture } from "./role-instance-fixture.ts";

test("retired provision is 404 while real HTTP role create/instantiate/list/revise retain snapshots and replay", async () => {
  const f = roleInstanceFixture();
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => {
      throw new Error("unused");
    },
  });
  try {
    await service.start();
    const client = new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => f.owner.accessToken,
    });
    const configuration = {
      ...f.role.configuration,
      handle: "http-reviewer",
      displayName: "HTTP Reviewer",
    };
    const retired = await fetch(
      `${service.origin}/v3/client/agents/provision`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${f.owner.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...configuration,
          controlRoomId: f.controlRoomId,
          basedOnRoomSeq: f.head(f.controlRoomId),
          idempotencyKey: "retired",
        }),
      },
    );
    assert.equal(retired.status, 404);
    const create = {
      controlRoomId: f.controlRoomId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "http-create",
      configuration,
    };
    const created = await client.request("role.create", create);
    assert.equal(
      (await client.request("role.create", create)).deduplicated,
      true,
    );
    const instantiate = {
      roleId: created.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "http-instance",
    };
    const instance = await client.request("role.instantiate", instantiate);
    assert.equal(
      (await client.request("role.instantiate", instantiate)).instance
        .instanceId,
      instance.instance.instanceId,
    );
    const revise = {
      roleId: created.role.roleId,
      expectedRoleRevisionId: created.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "http-revise",
      configuration: { ...configuration, instructions: "Revised instructions" },
    };
    const revised = await client.request("role.revise", revise);
    assert.notEqual(revised.role.roleRevisionId, created.role.roleRevisionId);
    assert.equal(
      (await client.request("role.revise", revise)).deduplicated,
      true,
    );
    const listed = await client.request("role.list", {
      controlRoomId: f.controlRoomId,
    });
    assert.equal(
      listed.roles.find((r) => r.roleId === created.role.roleId)
        ?.roleRevisionId,
      revised.role.roleRevisionId,
    );
    const frozen = listed.instances.find(
      (i) => i.instanceId === instance.instance.instanceId,
    )!;
    assert.equal(frozen.roleRevisionId, created.role.roleRevisionId);
    assert.equal(frozen.isCurrent, false);
    const remove = {
      roleId: created.role.roleId,
      expectedRoleRevisionId: revised.role.roleRevisionId,
      basedOnRoomSeq: f.head(f.controlRoomId),
      idempotencyKey: "http-delete",
    };
    assert.equal(
      (await client.request("role.delete", remove)).deduplicated,
      false,
    );
    assert.equal(
      (await client.request("role.delete", remove)).deduplicated,
      true,
    );
    assert.equal(
      (
        await client.request("role.list", { controlRoomId: f.controlRoomId })
      ).roles.some((r) => r.roleId === created.role.roleId),
      false,
    );
    assert.equal(
      (await client.request("role.instantiate", instantiate)).instance
        .instanceId,
      instance.instance.instanceId,
    );
    assert.equal(
      (await client.request("role.create", create)).role.roleId,
      created.role.roleId,
    );

    assert.equal(
      f.db.prepare("SELECT count(*) n FROM run_attempts").get()!.n,
      0,
    );
  } finally {
    await service.close();
    f.close();
  }
});

test("retired onboard cannot mutate a private box; direct open keeps its fixed pair and identity", async () => {
  const f = roleInstanceFixture();
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(f.kernel),
    health: () => {
      throw new Error("unused");
    },
  });
  try {
    await service.start();
    const client = new HttpRahClient({
      baseUrl: service.origin,
      accessToken: () => f.owner.accessToken,
    });
    const fresh = await client.request("role.instantiate", {
      roleId: f.role.roleId,
      channelId: f.home.roomId,
      basedOnRoomSeq: f.head(f.home.roomId),
      idempotencyKey: "fresh-private-peer",
    });
    const pairCount = () =>
      Number(f.db.prepare("SELECT count(*) n FROM direct_room_pairs").get()!.n);
    const pairsBefore = pairCount();
    const open = () =>
      client.request("room.direct.open", {
        workspaceId: f.workspace.workspace.workspaceId,
        peerPrincipalId: fresh.instance.instanceId,
        basedOnControlRoomSeq: f.head(f.controlRoomId),
        idempotencyKey: "direct-reopen",
      });
    const first = await open();
    assert.notEqual(first.room.roomId, f.privateBox.roomId);
    assert.equal(pairCount(), pairsBefore + 1);
    assert.equal((await open()).room.roomId, first.room.roomId);
    assert.equal(pairCount(), pairsBefore + 1);
    const members = () =>
      client.request("room.member.list", { roomId: first.room.roomId });
    const before = await members();
    assert.deepEqual(
      before.memberships.map((m) => m.principalId).sort(),
      [f.owner.principal.principalId, fresh.instance.instanceId].sort(),
    );
    assert.ok(before.memberships.every((m) => m.role === "member"));
    const response = await fetch(`${service.origin}/v3/client/agents/onboard`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${f.owner.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agentId: f.agentId,
        roomId: first.room.roomId,
        basedOnRoomSeq: f.head(first.room.roomId),
        idempotencyKey: "retired-onboard",
      }),
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await members(), before);
  } finally {
    await service.close();
    f.close();
  }
});
