import assert from "node:assert/strict";
export async function verifyAttachmentPreview({
  browser,
  origin,
  client,
  workspace,
  head,
}) {
  const { room } = await client.request("room.create", {
    workspaceId: workspace.workspaceId,
    kind: "channel",
    name: "FIXTURE document preview",
    slug: "fixture-document-preview",
    basedOnControlRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "document-preview-room",
  });
  const body =
    "# FIXTURE document\n\nA readable paragraph.\n\n## Second section\n\nSecond paragraph.";
  const file = await client.request("file.prepare", {
    roomId: room.roomId,
    filename: "fixture-document.md",
    mimeType: "text/markdown",
    size: Buffer.byteLength(body),
    idempotencyKey: "document-preview-file",
  });
  const cookie = (await fetch(origin)).headers.get("set-cookie").split(";")[0];
  const uploaded = await fetch(
    origin + "/v3/client/files/content/" + file.attachmentId,
    {
      method: "PUT",
      headers: {
        cookie,
        origin,
        authorization: "Bearer trusted-proxy-auth",
        "content-type": "application/octet-stream",
      },
      body,
    },
  );
  assert.equal(uploaded.status, 200);
  await client.request("message.post", {
    roomId: room.roomId,
    body: "FIXTURE preview",
    attachmentIds: [file.attachmentId],
    recipients: [],
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "document-preview-message",
  });
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage(),
        errors = [],
        writes = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/?room=" + room.roomId);
      await page
        .getByTestId("loom-message-attachments")
        .getByRole("button")
        .filter({ hasText: "fixture-document.md" })
        .click();
      const preview = page.getByTestId(
        "attachment-preview-browser-find-scroll",
      );
      await preview.waitFor({ timeout: 3000 });
      for (const label of ["下载", "关闭"]) {
        const box = await preview
          .getByRole("button", { name: label, exact: true })
          .boundingBox();
        assert.equal(box.width, 44);
        assert.equal(box.height, 44);
      }
      assert.equal(
        await preview
          .locator('[data-testid="attachment-preview-type-badge"]')
          .evaluate((el) => Math.round(el.getBoundingClientRect().height)),
        16,
      );
      await page.screenshot({ path: `/tmp/loom-preview-open-${width}.png` });
      await preview
        .getByRole("heading", { name: "FIXTURE document", exact: true })
        .waitFor();
      await preview
        .locator('[data-message-affordance="attachment-preview-mode"]')
        .click();
      await preview
        .getByText("A readable paragraph.", { exact: true })
        .dblclick({ position: { x: 10, y: 8 } });
      await preview
        .locator(
          '[data-message-affordance="attachment-comment-pending-anchor"]:visible',
        )
        .waitFor();
      const composer = preview.locator(
        '[data-message-affordance="attachment-comment-composer"]:visible',
      );
      await page.screenshot({
        path: `/tmp/loom-preview-comments-${width}.png`,
      });
      await composer
        .getByTestId("composer-textarea")
        .fill("FIXTURE comment " + width);
      let lose = true;
      await page.route("**/v3/client/files/comments/post", async (route) => {
        writes.push(route.request().postDataJSON());
        const response = await route.fetch();
        if (lose) {
          lose = false;
          await route.abort("failed");
        } else await route.fulfill({ response });
      });
      await composer.getByTestId("composer-textarea").press("Enter");
      await page.screenshot({ path: `/tmp/loom-preview-send-${width}.png` });
      await preview
        .getByRole("button", { name: "核实批注结果", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      assert.equal(
        await preview.isVisible(),
        true,
        "Unknown comment keeps its owner mounted",
      );
      assert.equal(writes.length, 1);
      await preview
        .getByRole("button", { name: "核实批注结果", exact: true })
        .click();
      await preview
        .locator("p:visible")
        .filter({ hasText: new RegExp("^FIXTURE comment " + width + "$") })
        .waitFor();
      assert.equal(writes[0].anchor.type, "md-section");
      // Native md-section requires a heading identity; quote is optional and
      // browser selection may collapse when focus moves into the composer.
      assert.equal(writes[0].anchor.data.headingId, "fixture-document");
      assert.equal(writes[0].anchor.data.headingTitle, "FIXTURE document");
      assert.deepEqual(
        writes[0],
        writes[1],
        "Verification replays the exact intent",
      );
      const comments = await client.request("file.comments", {
        attachmentId: file.attachmentId,
      });
      assert.equal(
        comments.comments.filter(
          (c) => c.content === "FIXTURE comment " + width,
        ).length,
        1,
      );
      await preview
        .locator("li:visible")
        .filter({ hasText: "FIXTURE comment " + width })
        .getByRole("button")
        .click();
      await preview.locator("#fixture-document.anchor-flash").waitFor();
      await page.screenshot({ path: `/tmp/loom-preview-result-${width}.png` });
      await preview.getByRole("button", { name: "关闭", exact: true }).click();
      await preview.waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
      results.push({
        width,
        nativeMarkdownPreview: true,
        nativeComments: true,
        unknownExactReplay: true,
        oneDurableComment: true,
        nativeSelectionAnchor: true,
        anchorJump: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
