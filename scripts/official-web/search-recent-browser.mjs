import assert from "node:assert/strict";
export async function verifySearchRecent({ browser, origin, channels }) {
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
      await page.goto(
        origin +
          "/?view=search&q=" +
          encodeURIComponent("#" + channels[0].name),
      );
      const row = page.getByTestId(
        "search-channel-result-" + channels[0].roomId,
      );
      await row.waitFor();
      await row.click({ button: "right" });
      const menu = page.getByRole("menu");
      await menu.waitFor({ timeout: 3000 });
      assert.equal(await menu.getByRole("menuitem").count(), 1);
      await menu.getByRole("menuitem", { name: "打开", exact: true }).click();
      await page.waitForURL(
        (u) =>
          u.searchParams.get("room") === channels[0].roomId &&
          !u.searchParams.has("view"),
      );
      await page.getByTestId("composer-textarea").waitFor();
      if (width === 1440) {
        await page.goto(origin + "/?room=" + channels[1].roomId);
        await page.getByTestId("composer-textarea").waitFor();
        await page.reload();
        await page.getByTestId("composer-textarea").waitFor();
        await page.getByTestId("app-top-bar-search").click();
        const overlay = page.getByTestId("desktop-search-overlay");
        const recent = overlay.getByTestId("search-overlay-recent");
        await recent.waitFor({ timeout: 3000 });
        assert.equal(
          await recent
            .getByTestId("search-channel-result-" + channels[1].roomId)
            .count(),
          0,
        );
        const prior = recent.getByTestId(
          "search-channel-result-" + channels[0].roomId,
        );
        await prior.waitFor();
        assert.equal(
          await overlay.getByTestId("search-view-all-results").count(),
          0,
        );
        await prior.click({ button: "right" });
        await menu.waitFor();
        await page.keyboard.press("Escape");
        await menu.waitFor({ state: "hidden" });
        assert.equal(await overlay.count(), 1);
        await overlay.getByRole("textbox", { name: "搜索内容" }).press("Enter");
        await page.waitForURL(
          (u) =>
            u.searchParams.get("room") === channels[0].roomId &&
            !u.searchParams.has("view"),
        );
        await overlay.waitFor({ state: "hidden" });
      }
      assert.deepEqual(errors, []);
      results.push({
        width,
        nativeSingleOpenMenu: true,
        recentVisitPersistence: width === 1440,
        currentConversationExcluded: width === 1440,
        menuEscapeRetainsOverlay: width === 1440,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
