import assert from "node:assert/strict";
export async function verifyLayout({ browser, origin, channels, client }) {
  const room = channels[0];
  const snapshot = await client.request("room.sync", {
    roomId: room.roomId,
    consumerId: "layout-fixture",
  });
  // Wide content must stay inside the message scroll viewport, not widen the app.
  await client.request("message.post", {
    roomId: room.roomId,
    basedOnRoomSeq: snapshot.latestRoomSeq,
    idempotencyKey: "layout-wide-fixture",
    recipients: [],
    body: "```text\n" + "WIDE_FIXTURE_".repeat(150) + "\n```",
  });
  const results = [];
  for (const width of [390, 900, 1440]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/?view=agents");
    await page.getByTestId("agent-sidebar-header").waitFor();
    if (width === 390) {
      const actual = await page
        .getByTestId("agent-sidebar-header")
        .evaluate((el) => ({
          background: getComputedStyle(el).backgroundColor,
          padding: getComputedStyle(el).paddingLeft,
        }));
      await page.goto(origin + "/?view=settings");
      await page.getByTestId("settings-sidebar-header").waitFor();
      const expected = await page
        .getByTestId("settings-sidebar-header")
        .evaluate((el) => ({
          background: getComputedStyle(el).backgroundColor,
          padding: getComputedStyle(el).paddingLeft,
        }));
      assert.deepEqual(
        actual,
        expected,
        "Agent mobile header must use the same signed-in native sidebar as Settings",
      );
    }
    for (const theme of ["brutal", "elegant"]) {
      await page.goto(origin + "/?view=settings&settings=appearance");
      await page.getByTestId("appearance-mode-light").click();
      await page
        .getByTestId("appearance-light-theme-" + theme)
        .locator("..")
        .locator("[data-theme]")
        .first()
        .click();
      await page.waitForFunction(
        (t) => document.documentElement.dataset.theme === t,
        theme,
      );
      for (const route of [
        "?room=" + room.roomId,
        "?view=agents",
        "?view=settings&settings=appearance",
        "?view=activity",
        "?view=search",
      ]) {
        await page.goto(origin + "/" + route);
        await page
          .getByTestId("loom-bootstrap-loading")
          .waitFor({ state: "hidden" });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          theme + " " + route + " width",
        );
        const header =
          route === "?view=agents"
            ? page.getByTestId("agent-sidebar-header")
            : page.locator('[data-slot="panel-header"]:visible').first();
        await header.waitFor();
        const h = (await header.boundingBox()).height;
        assert.ok(
          h >= (theme === "brutal" ? 62 : 56) && h < 100,
          `${theme} ${route} header ${h}`,
        );
        if (route.startsWith("?room=") && width >= 768) {
          await page.getByTestId("composer-textarea").waitFor();
          const dimensions = await page
            .getByTestId("loom-message-timeline")
            .evaluate((el) => ({
              content: el.scrollWidth,
              viewport: el.clientWidth,
            }));
          assert.ok(
            dimensions.content <= dimensions.viewport + 1,
            `wide message must not widen content: ${JSON.stringify(dimensions)}`,
          );
        }
      }
      results.push({ width, theme, headersAndOverflow: true });
    }
    await page.screenshot({
      path: `/tmp/loom-layout-${width}.png`,
      animations: "disabled",
    });
    assert.deepEqual(errors, []);
    await context.close();
  }
  return results;
}
