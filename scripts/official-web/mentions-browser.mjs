import assert from "node:assert/strict";
export async function verifyMentions({
  browser,
  origin,
  client,
  channel,
  otherChannel,
  instance,
  name,
}) {
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage();
      await page.route("**/*", (route) =>
        new URL(route.request().url()).origin === origin
          ? route.continue()
          : route.abort(),
      );
      await page.goto(`${origin}/?room=${channel.roomId}`);
      const composer = page.getByTestId("composer-textarea");
      await composer.waitFor();
      let sends = 0;
      page.on("request", (r) => {
        if (new URL(r.url()).pathname === "/v3/client/messages/post") sends++;
      });
      await composer.fill("@Fixture");
      await page
        .getByText(name, { exact: true })
        .filter({ visible: true })
        .last()
        .waitFor()
        .catch(async (e) => {
          await page.screenshot({ path: "/tmp/loom-mentions-failure.png" });
          console.error(await page.locator("body").innerText());
          throw e;
        });
      assert.equal(
        await page.locator("[data-mention-avatar-badge-shell]").count(),
        0,
        "unknown execution state must not be shown as offline",
      );
      await page.screenshot({
        path: `/tmp/loom-mention-picker-${viewport.width}.png`,
        animations: "disabled",
      });
      if (viewport.width >= 768) await composer.press("Enter");
      else
        await page
          .getByText(name, { exact: true })
          .filter({ visible: true })
          .last()
          .click();
      assert.equal(sends, 0, "candidate selection never sends");
      assert.ok((await composer.inputValue()).includes(`@${name}`));
      await composer.fill(`@${name} FIXTURE mention ${viewport.width}`);
      await composer.press("Enter");
      const body = `@${name} FIXTURE mention ${viewport.width}`;
      await page.getByText(body, { exact: true }).waitFor();
      const message = (
        await client.request("message.list", {
          roomId: channel.roomId,
          limit: 50,
        })
      ).messages.find((m) => m.body === body);
      assert.ok(message);
      assert.ok(
        message.mentions.some((m) => m.principalId === instance.instanceId),
      );
      await page
        .locator('[data-testid^="message-sender-mention-"]')
        .first()
        .click();
      assert.equal(
        await composer.inputValue(),
        `@${(await client.request("principal.me", {})).principal.handle} `,
      );
      assert.equal(
        await composer.evaluate((el) => document.activeElement === el),
        true,
      );
      await composer.fill("");
      await composer.fill("@Fixture");
      const candidate = page
        .getByText(name, { exact: true })
        .filter({ visible: true })
        .last();
      await candidate.waitFor();
      await page.route("**/v3/client/rooms/sync", (route) =>
        route.request().postDataJSON().roomId === channel.roomId
          ? route.abort()
          : route.continue(),
      );
      await page.getByRole("alert").waitFor();
      await candidate.waitFor({ state: "hidden" });
      await page.unroute("**/v3/client/rooms/sync");
      await page.getByRole("alert").waitFor({ state: "hidden" });
      await candidate.waitFor();
      await composer.press("Escape");
      await candidate.waitFor({ state: "hidden" });
      await composer.fill("");
      await page.goto(`${origin}/?room=${otherChannel.roomId}`);
      await composer.waitFor();
      await page.getByTestId("loom-message-timeline").waitFor();
      await composer.fill("@Fixture");
      assert.equal(
        await page
          .getByText(name, { exact: true })
          .filter({ visible: true })
          .count(),
        0,
        "other channel has no candidate leak",
      );
      await composer.fill("");
      results.push({
        viewport,
        canonicalMention: true,
        senderClickFocus: true,
        keyboardOrPointerSelection: true,
        membershipFailureClearsAndRecovers: true,
        channelIsolation: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
