// Real temporary Core and uploaded bytes; no model execution.
import assert from "node:assert/strict";
export async function verifyTextPreview({
  browser,
  origin,
  client,
  workspace,
  head,
}) {
  const { room } = await client.request("room.create", {
    workspaceId: workspace.workspaceId,
    kind: "channel",
    name: "FIXTURE text preview",
    slug: "fixture-text-preview",
    basedOnControlRoomSeq: await head(workspace.controlRoomId),
    idempotencyKey: "text-preview-room",
  });
  const body =
    "FIXTURE 中文与 English\n\n<script>window.__textExecuted=true</script>\n" +
    "长行 English ".repeat(80);
  const file = await client.request("file.prepare", {
    roomId: room.roomId,
    filename: "fixture-text.txt",
    mimeType: "text/plain",
    size: Buffer.byteLength(body),
    idempotencyKey: "text-preview-file",
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
    body: "FIXTURE text attachment",
    attachmentIds: [file.attachmentId],
    recipients: [],
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "text-preview-message",
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
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/?room=" + room.roomId);
      const trigger = page
        .getByTestId("loom-message-attachments")
        .getByRole("button")
        .filter({ hasText: "fixture-text.txt" });
      await trigger.click();
      const preview = page.getByTestId(
        "attachment-preview-browser-find-scroll",
      );
      const lines = preview.locator("[data-anchor-line]");
      await lines.first().waitFor();
      assert.equal(await lines.count(), 4);
      assert.equal(await lines.nth(0).textContent(), "FIXTURE 中文与 English");
      assert.equal(
        await lines.nth(2).textContent(),
        "<script>window.__textExecuted=true</script>",
      );
      assert.equal(await page.evaluate(() => window.__textExecuted), undefined);
      const styles = await preview.locator("pre").evaluate((el) => {
        const css = getComputedStyle(el);
        return {
          whiteSpace: css.whiteSpace,
          font: css.fontFamily,
          size: css.fontSize,
          overflow: el.scrollWidth > el.clientWidth + 1,
        };
      });
      assert.equal(styles.whiteSpace, "pre-wrap");
      assert.match(styles.font, /mono/i);
      assert.equal(styles.overflow, false);
      for (const label of ["关闭", "下载"]) {
        const bounds = await preview
          .getByRole("button", { name: label, exact: true })
          .boundingBox();
        assert.equal(bounds.width, 44);
        assert.equal(bounds.height, 44);
      }
      const downloadPromise = page.waitForEvent("download");
      await preview.getByRole("button", { name: "下载", exact: true }).click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), "fixture-text.txt");
      const stream = await download.createReadStream(),
        chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      assert.equal(Buffer.concat(chunks).toString(), body);
      await page.screenshot({ path: `/tmp/loom-text-preview-${width}.png` });
      await page.keyboard.press("Escape");
      await preview.waitFor({ state: "detached" });
      await trigger.click();
      await lines.first().waitFor();
      await preview.getByRole("button", { name: "关闭", exact: true }).click();
      await preview.waitFor({ state: "detached" });
      assert.deepEqual(errors, []);
      results.push({
        width,
        styles,
        literalText: true,
        linesPreserved: true,
        exactDownload: true,
        escapeAndClose: true,
        reopen: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
