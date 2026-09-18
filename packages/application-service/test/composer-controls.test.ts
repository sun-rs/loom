import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomKernel, createHumanApplicationPort } from "@rah-os/kernel";
import {
  ClientHealthResponseSchema,
  ComputerFilesListResponseSchema,
  RoomExecutionReadResponseSchema,
  ClientRoomAgentSosResponseSchema,
} from "@rah-os/protocol";
import { ComputerFileBrowser } from "@rah-os/agent-host";
import { ClientApplicationService } from "../src/index.ts";

test("computer paths and composer stop use the authenticated HTTP facade", async () => {
  const directory = mkdtempSync(join(tmpdir(), "rah-composer-http-"));
  const kernel = new RoomKernel({ databasePath: join(directory, "db") });
  const root = join(directory, "files");
  mkdirSync(root);
  writeFileSync(join(root, "note.txt"), "not an upload");
  let reads = 0;
  const browser = new ComputerFileBrowser({
    hostId: "mac",
    label: "Mac",
    roots: [root],
  });
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(kernel),
    health: () => ClientHealthResponseSchema.parse({}),
    computerFiles: {
      list: async (input) => {
        reads++;
        return browser.list(input);
      },
    },
  });
  try {
    kernel.initialize();
    const human = kernel.provisionPrincipal({ kind: "human", handle: "owner" });
    const agent = kernel.provisionPrincipal({ kind: "agent", handle: "agent" });
    const actor = kernel.authenticateAccessToken(human.accessToken);
    const room = kernel.createRoom(actor, { name: "Room", slug: "room" });
    await service.start();
    const post = (path: string, data: unknown, token?: string) =>
      fetch(`${service.origin}/v3/client/${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });
    assert.equal(
      (await post("computers/files/list", { path: "" })).status,
      401,
    );
    assert.equal(
      (await post("computers/files/list", { path: "" }, agent.accessToken))
        .status,
      401,
    );
    assert.equal(reads, 0);
    assert.equal(
      (await post("computers/files/list", { path: "../" }, human.accessToken))
        .status,
      400,
    );
    const files = await post(
      "computers/files/list",
      { path: "" },
      human.accessToken,
    );
    assert.equal(files.status, 200, await files.clone().text());
    const listing = ComputerFilesListResponseSchema.parse(await files.json());
    assert.equal(listing.entries[0]!.absolutePath, join(root, "note.txt"));
    assert.equal("content" in listing.entries[0]!, false);
    const state = RoomExecutionReadResponseSchema.parse(
      await (
        await post("rooms/sos/read", { roomId: room.roomId }, human.accessToken)
      ).json(),
    );
    const stopped = await post(
      "rooms/sos/stop",
      {
        roomId: room.roomId,
        basedOnRoomSeq: state.latestRoomSeq,
        idempotencyKey: "stop",
        resumeOnMessage: true,
      },
      human.accessToken,
    );
    assert.equal(stopped.status, 200, await stopped.clone().text());
    const stop = ClientRoomAgentSosResponseSchema.parse(await stopped.json());
    assert.equal(stop.operation.state, "stopped");
    assert.equal(
      (await post("rooms/sos/read", { roomId: room.roomId }, agent.accessToken))
        .status,
      401,
    );
    const correction = await post(
      "messages/post",
      {
        roomId: room.roomId,
        body: "Correction",
        recipients: [],
        basedOnRoomSeq: stop.event.roomSeq,
        idempotencyKey: "correction",
      },
      human.accessToken,
    );
    assert.equal(correction.status, 200, await correction.clone().text());
    assert.equal(
      RoomExecutionReadResponseSchema.parse(
        await (
          await post(
            "rooms/sos/read",
            { roomId: room.roomId },
            human.accessToken,
          )
        ).json(),
      ).operation,
      null,
    );
  } finally {
    await service.close();
    kernel.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
