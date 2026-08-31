import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RoomKernel, createHumanApplicationPort } from "@rah-os/kernel";
import { HttpRahClient } from "@rah-os/client-sdk";
import { ClientApplicationService } from "../src/index.ts";

test("Files HTTP + SDK roundtrip verifies bytes, Room provenance, authorization and safe download headers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rah-client-files-"));
  const kernel = new RoomKernel({ databasePath: join(dir, "room.db") });
  kernel.initialize();
  const human = kernel.provisionPrincipal({ handle: "human", kind: "human" });
  const actor = kernel.authenticateAccessToken(human.accessToken);
  const workspace = kernel.createWorkspace(actor, {
    name: "Files",
    slug: "files",
    idempotencyKey: "workspace",
  });
  const roomId = kernel.createWorkspaceRoom(actor, {
    kind: "channel",
    name: "Files",
    slug: "files",
    workspaceId: workspace.workspace.workspaceId,
    basedOnControlRoomSeq: kernel.sync(actor, {
      roomId: workspace.controlRoom.roomId,
      consumerId: "head",
    }).latestRoomSeq,
    idempotencyKey: "room",
  }).room.roomId;
  const service = new ClientApplicationService({
    human: createHumanApplicationPort(kernel),
    health: () => ({
      apiVersion: 3,
      buildVersion: "test",
      kernelSchemaVersion: 22,
      protocolVersion: 1,
      state: "online",
      capabilities: {
        agentOnboard: true,
        agentRead: true,
        agentWrite: true,
        cursorAcknowledge: true,
        hints: false,
        inputRequestRead: true,
        inputRequestResolve: true,
        managedMcpRead: true,
        managedMcpWrite: true,
        memberRead: true,
        memberWrite: true,
        messageRead: true,
        messageWrite: true,
        roomRead: true,
        roomWrite: true,
        roomSync: true,
        taskRead: true,
        taskWrite: true,
        threadRead: true,
        threadWrite: true,
        workspaceRead: true,
        workspaceWrite: true,
      },
    }),
  });
  try {
    await service.start();
    const client = new HttpRahClient({
      accessToken: () => human.accessToken,
      baseUrl: service.origin,
    });
    const blob = new Blob([
      "<script>throw new Error('must not execute')</script> 中文",
    ]);
    const prepared = await client.request("file.prepare", {
      roomId,
      filename: "untrusted.html",
      mimeType: "text/html",
      size: blob.size,
      idempotencyKey: "file",
    });
    const uploaded = await client.files.upload(prepared.attachmentId, blob);
    assert.equal(uploaded.state, "completed");
    assert.deepEqual((await client.request("file.list", { roomId })).files, []);
    const sent = await client.request("message.post", {
      roomId,
      body: "",
      attachmentIds: [prepared.attachmentId],
      basedOnRoomSeq: kernel.sync(actor, { roomId, consumerId: "head" })
        .latestRoomSeq,
      recipients: [],
      idempotencyKey: "message",
    });
    const files = await client.request("file.list", { roomId });
    assert.equal(files.files[0]?.messageId, sent.event.aggregateId);
    const bytes = await client.files.download(prepared.attachmentId);
    assert.equal(await bytes.text(), await blob.text());
    const url = `${service.origin}/v3/client/files/content/${prepared.attachmentId}`;
    assert.equal((await fetch(url)).status, 401);
    const download = await fetch(url, {
      headers: { authorization: `Bearer ${human.accessToken}` },
    });
    assert.equal(
      download.headers.get("content-type"),
      "application/octet-stream",
    );
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.match(download.headers.get("content-disposition")!, /^attachment;/);
    await download.arrayBuffer();
    const malformed = await fetch(`${service.origin}/v3/client/files/prepare`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${human.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        roomId,
        filename: "x",
        mimeType: "text/plain",
        size: 201 * 1024 * 1024,
        idempotencyKey: "oversize",
      }),
    });
    assert.equal(malformed.status, 400);
  } finally {
    await service.close();
    kernel.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
