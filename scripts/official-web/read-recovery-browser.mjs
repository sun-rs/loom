// Bounded closeout checks: real temporary Core; injected transport failures, no providers.
import assert from "node:assert/strict";
export async function verifyReadRecovery({
  browser,
  origin,
  client,
  channels,
  head,
}) {
  const room = channels[0];
  for (const word of ["old", "new"])
    await client.request("message.post", {
      roomId: room.roomId,
      body: `FIXTURE recovery${word}unique`,
      recipients: [],
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `recovery-${word}`,
    });
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      locale: "zh-CN",
    });
    try {
      const page = await context.newPage(),
        errors = [];
      page.setDefaultTimeout(15000);
      page.on("pageerror", (e) => errors.push(e.message));
      let fail = true;
      await page.route("**/v3/client/search", (route) =>
        fail ? route.abort() : route.continue(),
      );
      await page.goto(
        origin + "/?view=search&q=" + encodeURIComponent("recoveryoldunique"),
      );
      const alert = page
        .getByRole("alert")
        .filter({ hasText: "读取失败，请重试。" });
      await alert.waitFor();
      assert.equal(await page.locator("[data-result-id]").count(), 0);
      fail = false;
      await alert
        .getByRole("button", { name: "重新读取", exact: true })
        .click();
      const old = page
        .locator("[data-result-id]")
        .filter({ hasText: "recoveryoldunique" });
      await old.waitFor();
      await page.unroute("**/v3/client/search");
      let release, arrived;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      const received = new Promise((resolve) => {
        arrived = resolve;
      });
      await page.route("**/v3/client/search", async (route) => {
        if (route.request().postDataJSON().query === "recoveryoldunique") {
          const response = await route.fetch();
          arrived();
          await held;
          try {
            await route.fulfill({ response });
          } catch {
            /* Aborted superseded request. */
          }
        } else await route.continue();
      });
      const input = page.getByRole("textbox", {
        name: "搜索内容",
        exact: true,
      });
      await input.fill("recoverynewunique");
      const fresh = page
        .locator("[data-result-id]")
        .filter({ hasText: "recoverynewunique" });
      await fresh.waitFor();
      await input.fill("recoveryoldunique");
      await received;
      await input.fill("recoverynewunique");
      await fresh.waitFor();
      release();
      await page.evaluate(async () => {
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
      assert.equal(await old.count(), 0);
      assert.equal(await fresh.count(), 1);
      await page.unroute("**/v3/client/search");
      // A directory failure must not fabricate empty success; explicit read retry restores it.
      await page.route("**/v3/client/roles/list", (route) => route.abort());
      await page.goto(
        origin + "/?view=search&q=" + encodeURIComponent("#" + room.name),
      );
      const directory = page
        .getByRole("alert")
        .filter({ hasText: "对话目录读取失败。" });
      await directory.waitFor();
      await page.unroute("**/v3/client/roles/list");
      await directory
        .getByRole("button", { name: "重新读取目录", exact: true })
        .click();
      await page.getByTestId("search-channel-result-" + room.roomId).waitFor();
      await directory.waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
      results.push({
        width,
        failedReadClearsResults: true,
        explicitRetry: true,
        staleQueryCannotReplaceNewer: true,
        directoryRecovery: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
