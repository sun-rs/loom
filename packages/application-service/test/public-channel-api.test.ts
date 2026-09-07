import assert from "node:assert/strict";
import test from "node:test";
import { publicChannelFixture } from "../../kernel/test/public-channel-fixture.ts";
import { ClientApplicationService } from "../src/index.ts";
import { PublicChannelDirectoryResponseSchema } from "../../protocol/src/index.ts";
import { HttpRahClient } from "../../client-sdk/src/index.ts";

test("public Channel HTTP and SDK share authenticated discovery and self-join authority", async () => {
  const f = publicChannelFixture(),
    service = new ClientApplicationService({
      human: f.port,
      health: () => ({
        apiVersion: 3,
        buildVersion: "test",
        capabilities: {} as never,
        kernelSchemaVersion: 29,
        protocolVersion: 1,
        state: "online",
      }),
    });
  try {
    await service.start();
    const { reader, outsider, agent } = f.people,
      workspaceId = f.workspace.workspace.workspaceId;
    const request = async (
      path: string,
      body: unknown,
      token: string | undefined = reader!.accessToken,
    ) =>
      fetch(service.origin + "/v3/client/" + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: "Bearer " + token } : {}),
        },
        body: JSON.stringify(body),
      });
    const response = await request("rooms/public/discover", { workspaceId });
    assert.equal(response.status, 200);
    const directory = PublicChannelDirectoryResponseSchema.parse(
      await response.json(),
    );
    assert.equal(directory.channels.length, 1);
    assert.equal(directory.channels[0]!.membership, undefined);
    for (const [token, status] of [
      [outsider!.accessToken, 403],
      [agent!.accessToken, 401],
    ] as const)
      assert.equal(
        (await request("rooms/public/discover", { workspaceId }, token)).status,
        status,
      );
    assert.equal(
      (await request("rooms/public/discover", { workspaceId }, "")).status,
      401,
    );
    const input = f.request();
    assert.equal(
      (
        await request("rooms/public/join", {
          ...input,
          principalId: outsider!.principal.principalId,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request("rooms/public/join", { ...input, role: "owner" })).status,
      400,
    );
    const sdk = new HttpRahClient({
      accessToken: () => reader!.accessToken,
      baseUrl: service.origin,
    });
    const listed = await sdk.request("room.public.discover", {
      workspaceId,
      limit: 1,
    });
    assert.equal(listed.channels[0]!.room.roomId, input.roomId);
    const preview = await sdk.request("room.preview", {
      workspaceId,
      roomId: input.roomId,
    });
    assert.equal(preview.membership, undefined);
    assert.deepEqual(preview.messages, []);
    assert.equal(
      (
        await request(
          "rooms/preview",
          { workspaceId, roomId: input.roomId },
          outsider!.accessToken,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request("rooms/preview", {
          workspaceId,
          roomId: input.roomId,
          actorId: reader!.principal.principalId,
        })
      ).status,
      400,
    );
    const joined = await sdk.request("room.public.join", input);
    assert.equal(joined.membership.principalId, reader!.principal.principalId);
    assert.equal(joined.membership.role, "member");
    assert.deepEqual(await sdk.request("room.public.join", input), {
      ...joined,
      deduplicated: true,
    });
    assert.equal(
      f.port.discoverPublicChannels(reader!.actor, { workspaceId }).channels[0]!
        .membership!.principalId,
      reader!.principal.principalId,
    );
  } finally {
    await service.close();
    f.close();
  }
});
