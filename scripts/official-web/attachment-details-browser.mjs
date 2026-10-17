import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
export async function verifyAttachmentDetails({
  browser,
  origin,
  client,
  workspace,
  head,
  role,
}) {
  const room = (
    await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      name: "FIXTURE attachment details",
      slug: "fixture-attachment-details",
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "attachment-details-room",
    })
  ).room;
  const member = await client.request("role.instantiate", {
    roleId: role.roleId,
    channelId: room.roomId,
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "attachment-details-member",
  });
  await client.request("agent.manage", {
    action: "set_state",
    agentId: member.instance.agentId,
    state: "disabled",
    basedOnRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "attachment-details-disabled",
  });
  const box = (
    await client.request("room.direct.open", {
      workspaceId: workspace.workspaceId,
      peerPrincipalId: member.instance.instanceId,
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "attachment-details-box",
    })
  ).room;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
    serviceWorkers: "block",
  });
  try {
    const page = await context.newPage(),
      errors = [],
      external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        external.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    const selectFile = async (surface, file) => {
      await surface
        .getByRole("button", { name: "引用计算机文件或文件夹", exact: true })
        .click();
      const picker = page.getByRole("dialog", {
        name: "引用文件或文件夹",
      });
      const upload = picker.getByTestId("loom-native-file-input");
      await upload.click({ trial: true });
      await upload.setInputFiles(file);
      await picker.waitFor({ state: "detached" });
    };
    const png = {
      name: "fixture-image.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    };
    await page.goto(origin + "/?fileDevice=remote&room=" + room.roomId);
    const composer = page.getByTestId("chat-composer-shell");
    await selectFile(composer, png);
    await composer.locator('[data-upload-status="ready"]').waitFor();
    await composer
      .getByRole("button", { name: "移除 " + png.name, exact: true })
      .click();
    await selectFile(composer, png);
    await composer.locator('[data-upload-status="ready"]').waitFor();
    await composer.locator('button[type="submit"]').click();
    const image = page
      .getByTestId("loom-message-attachments")
      .filter({ has: page.getByRole("img", { name: png.name, exact: true }) });
    await image.waitFor();
    await image
      .getByRole("button", {
        name: new RegExp("预览.*" + png.name.replaceAll(".", "\\.")),
        exact: true,
      })
      .click();
    const preview = page.getByTestId("image-lightbox-image");
    await preview.waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="image-lightbox-image"]')
          .naturalWidth === 1,
    );
    await page.screenshot({
      path: "/tmp/loom-attachment-image.png",
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await preview.waitFor({ state: "detached" });
    const root = (
      await client.request("message.list", { roomId: room.roomId, limit: 50 })
    ).messages.find((m) => m.attachments?.some((a) => a.filename === png.name));
    assert.ok(root);
    await page.goto(
      origin +
        "/?fileDevice=remote&room=" +
        room.roomId +
        "&thread=" +
        root.messageId,
    );
    const panel = page.getByTestId("thread-side-column");
    const text = {
      name: "thread.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("thread exact bytes"),
    };
    await page.route("**/v3/client/files/content/*", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "unavailable", message: "FIXTURE upload failure" },
            }),
          })
        : route.continue(),
    );
    await selectFile(panel, text);
    await panel.getByText("FIXTURE upload failure", { exact: true }).waitFor();
    assert.equal(
      await panel.locator('button[type="submit"]').isDisabled(),
      true,
    );
    await panel
      .getByRole("button", { name: "移除 " + text.name, exact: true })
      .click();
    await page.unroute("**/v3/client/files/content/*");
    await selectFile(panel, text);
    await panel.locator('[data-upload-status="ready"]').waitFor();
    const replies = [];
    await page.route("**/v3/client/threads/reply", async (route) => {
      replies.push(route.request().postDataJSON());
      if (replies.length === 1) {
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await panel.locator('button[type="submit"]').click();
    await page
      .getByRole("button", { name: "核实回复结果", exact: true })
      .click();
    await panel
      .getByTestId("loom-attachment-drafts")
      .waitFor({ state: "detached" });
    assert.equal(replies.length, 2);
    assert.deepEqual(replies[0], replies[1]);
    await page.reload();
    const threadCard = panel
      .getByTestId("loom-message-attachments")
      .filter({ hasText: text.name });
    await threadCard.waitFor();
    await threadCard.getByText(text.name, { exact: true }).click();
    await page.getByTestId("attachment-preview-browser-find-scroll").waitFor();
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: "下载", exact: true }).click();
    assert.deepEqual(await readFile(await (await dl).path()), text.buffer);
    await page.goto(origin + "/?fileDevice=remote&room=" + box.roomId);
    await selectFile(composer, { ...text, name: "private.txt" });
    await composer.locator('[data-upload-status="ready"]').waitFor();
    await composer.locator('button[type="submit"]').click();
    await page
      .getByTestId("loom-message-attachments")
      .filter({ hasText: "private.txt" })
      .waitFor();
    const privateMessages = (
      await client.request("message.list", { roomId: box.roomId, limit: 50 })
    ).messages;
    assert.equal(
      privateMessages.filter((m) =>
        m.attachments?.some((a) => a.filename === "private.txt"),
      ).length,
      1,
    );
    assert.equal(
      (
        await client.request("message.list", { roomId: room.roomId, limit: 50 })
      ).messages.some((m) =>
        m.attachments?.some((a) => a.filename === "private.txt"),
      ),
      false,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    return {
      imageNativeLightbox: true,
      sameFileReselection: true,
      failedUploadBlocksSend: true,
      threadAttachmentOnly: true,
      threadExactUnknownReplay: true,
      threadReloadDownload: true,
      privateBoxIsolation: true,
    };
  } finally {
    await context.close();
  }
}
