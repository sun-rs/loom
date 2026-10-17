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
  const targetRoomId = kernel.createWorkspaceRoom(actor, {
    kind: "channel",
    name: "Forwarded files",
    slug: "forwarded-files",
    workspaceId: workspace.workspace.workspaceId,
    basedOnControlRoomSeq: kernel.sync(actor, {
      roomId: workspace.controlRoom.roomId,
      consumerId: "target-head",
    }).latestRoomSeq,
    idempotencyKey: "target-room",
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
    const forwarded = await client.request("message.forward", {
      destinationRoomIds: [targetRoomId],
      requestId: "forward-file",
      sourceMessageIds: [sent.event.aggregateId],
      sourceRoomId: roomId,
    });
    assert.equal(forwarded.results[0]?.status, "delivered");
    const targetMessages = await client.request("message.list", {
      limit: 50,
      roomId: targetRoomId,
    });
    const projected =
      targetMessages.messages[0]?.forwardedBundle?.items[0]?.attachments[0];
    assert.ok(projected);
    assert.equal(
      targetMessages.messages[0]?.forwardedBundle?.items[0]?.attachmentPolicy,
      "projected",
    );
    assert.notEqual(projected.attachmentId, prepared.attachmentId);
    assert.equal(
      await (await client.files.download(projected.attachmentId)).text(),
      await blob.text(),
    );
    assert.equal(
      (await client.request("file.list", { roomId: targetRoomId })).files[0]
        ?.attachmentId,
      projected.attachmentId,
    );
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
    const fullBytes = Buffer.from(await download.arrayBuffer());
    const htmlUrl = `${service.origin}/v3/client/files/html-preview/${prepared.attachmentId}?acBridgeNonce=fixture&acBridgeParentOrigin=https%3A%2F%2Floom.test`;
    assert.equal((await fetch(htmlUrl)).status, 401);
    const html = await fetch(htmlUrl, {
      headers: { authorization: `Bearer ${human.accessToken}` },
    });
    assert.equal(html.status, 200);
    assert.equal(html.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(
      html.headers.get("content-security-policy")!,
      /sandbox allow-scripts/,
    );
    assert.match(
      html.headers.get("content-security-policy")!,
      /connect-src 'none'/,
    );
    const htmlBody = await html.text();
    assert.ok(htmlBody.includes(await blob.text()));
    assert.match(htmlBody, /acBridgeNonce/);
    assert.equal(
      (
        await fetch(htmlUrl, {
          method: "PUT",
          headers: { authorization: `Bearer ${human.accessToken}` },
          body: "overwrite",
        })
      ).status,
      405,
    );

    const dataUrl = `${service.origin}/v3/client/files/data-preview/${prepared.attachmentId}`;
    assert.equal((await fetch(dataUrl)).status, 401);
    assert.equal(
      (
        await fetch(dataUrl, {
          method: "PUT",
          headers: { authorization: `Bearer ${human.accessToken}` },
          body: "overwrite",
        })
      ).status,
      405,
    );
    assert.deepEqual(
      await (
        await fetch(dataUrl, {
          headers: { authorization: `Bearer ${human.accessToken}` },
        })
      ).json(),
      { status: "unsupported", reason: "unsupported" },
    );
    const previewUrl = `${service.origin}/v3/client/files/preview/${prepared.attachmentId}`;
    const preview = await fetch(previewUrl, {
      headers: { authorization: `Bearer ${human.accessToken}` },
    });
    assert.equal(preview.status, 200);
    assert.equal(
      preview.headers.get("content-type"),
      "text/plain; charset=utf-8",
    );
    assert.equal(preview.headers.get("x-original-content-type"), "text/html");
    assert.equal(preview.headers.get("x-content-type-options"), "nosniff");
    assert.equal(preview.headers.get("cache-control"), "private, no-store");
    assert.match(
      preview.headers.get("content-security-policy")!,
      /default-src 'none'/u,
    );
    assert.equal(await preview.text(), await blob.text());
    assert.equal(
      await client.files.previewText(prepared.attachmentId),
      await blob.text(),
    );
    assert.equal((await fetch(previewUrl)).status, 401);
    const outsider = kernel.provisionPrincipal({
      handle: "outsider",
      kind: "human",
    });
    assert.equal(
      (
        await fetch(htmlUrl, {
          headers: { authorization: `Bearer ${outsider.accessToken}` },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(previewUrl, {
          headers: { authorization: `Bearer ${outsider.accessToken}` },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(dataUrl, {
          headers: { authorization: `Bearer ${outsider.accessToken}` },
        })
      ).status,
      403,
    );
    const range = await fetch(url, {
      headers: {
        authorization: `Bearer ${human.accessToken}`,
        range: "bytes=1-7",
      },
    });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("accept-ranges"), "bytes");
    assert.equal(
      range.headers.get("content-range"),
      `bytes 1-7/${String(fullBytes.length)}`,
    );
    assert.equal(range.headers.get("content-length"), "7");
    assert.deepEqual(
      Buffer.from(await range.arrayBuffer()),
      fullBytes.subarray(1, 8),
    );
    const sdkRange = await client.files.downloadRange(prepared.attachmentId, {
      start: 2,
      end: 9,
    });
    assert.deepEqual(
      Buffer.from(await sdkRange.arrayBuffer()),
      fullBytes.subarray(2, 10),
    );
    const suffix = await fetch(url, {
      headers: {
        authorization: `Bearer ${human.accessToken}`,
        range: "bytes=-6",
      },
    });
    assert.equal(suffix.status, 206);
    assert.deepEqual(
      Buffer.from(await suffix.arrayBuffer()),
      fullBytes.subarray(-6),
    );
    const openEnded = await fetch(url, {
      headers: {
        authorization: `Bearer ${human.accessToken}`,
        range: "bytes=8-",
      },
    });
    assert.equal(openEnded.status, 206);
    assert.equal(
      openEnded.headers.get("content-range"),
      `bytes 8-${String(fullBytes.length - 1)}/${String(fullBytes.length)}`,
    );
    assert.deepEqual(
      Buffer.from(await openEnded.arrayBuffer()),
      fullBytes.subarray(8),
    );
    const unsatisfiable = await fetch(url, {
      headers: {
        authorization: `Bearer ${human.accessToken}`,
        range: `bytes=${String(fullBytes.length + 10)}-`,
      },
    });
    assert.equal(unsatisfiable.status, 416);
    assert.equal(
      unsatisfiable.headers.get("content-range"),
      `bytes */${String(fullBytes.length)}`,
    );
    const invalidUnit = await fetch(url, {
      headers: {
        authorization: `Bearer ${human.accessToken}`,
        range: "items=0-2",
      },
    });
    assert.equal(invalidUnit.status, 416);
    assert.equal(
      invalidUnit.headers.get("content-range"),
      `bytes */${String(fullBytes.length)}`,
    );
    const multiple = await fetch(url, {
      headers: {
        authorization: `Bearer ${human.accessToken}`,
        range: "bytes=0-2,5-7",
      },
    });
    assert.equal(multiple.status, 200);
    assert.equal(multiple.headers.get("content-range"), null);
    assert.deepEqual(Buffer.from(await multiple.arrayBuffer()), fullBytes);

    const unsupportedBlob = new Blob(["%PDF-not-a-real-document"]);
    const unsupported = await client.request("file.prepare", {
      roomId,
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: unsupportedBlob.size,
      idempotencyKey: "unsupported-preview",
    });
    await client.files.upload(unsupported.attachmentId, unsupportedBlob);
    await client.request("message.post", {
      roomId,
      body: "PDF",
      attachmentIds: [unsupported.attachmentId],
      basedOnRoomSeq: kernel.sync(actor, { roomId, consumerId: "head-pdf" })
        .latestRoomSeq,
      recipients: [],
      idempotencyKey: "message-pdf",
    });
    const unsupportedPreview = await fetch(
      `${service.origin}/v3/client/files/preview/${unsupported.attachmentId}`,
      { headers: { authorization: `Bearer ${human.accessToken}` } },
    );
    assert.equal(unsupportedPreview.status, 415);
    const htmlUnsupported = await fetch(
      `${service.origin}/v3/client/files/html-preview/${unsupported.attachmentId}`,
      { headers: { authorization: `Bearer ${human.accessToken}` } },
    );
    assert.equal(htmlUnsupported.status, 415);

    const largeBlob = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)]);
    const large = await client.request("file.prepare", {
      roomId,
      filename: "large.html",
      mimeType: "text/html",
      size: largeBlob.size,
      idempotencyKey: "large-preview",
    });
    await client.files.upload(large.attachmentId, largeBlob);
    await client.request("message.post", {
      roomId,
      body: "large",
      attachmentIds: [large.attachmentId],
      basedOnRoomSeq: kernel.sync(actor, { roomId, consumerId: "head-large" })
        .latestRoomSeq,
      recipients: [],
      idempotencyKey: "message-large",
    });
    const largePreview = await fetch(
      `${service.origin}/v3/client/files/preview/${large.attachmentId}`,
      { headers: { authorization: `Bearer ${human.accessToken}` } },
    );
    assert.equal(largePreview.status, 413);
    const htmlLarge = await fetch(
      `${service.origin}/v3/client/files/html-preview/${large.attachmentId}`,
      { headers: { authorization: `Bearer ${human.accessToken}` } },
    );
    assert.equal(htmlLarge.status, 413);
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
