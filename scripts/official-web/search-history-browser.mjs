import assert from "node:assert/strict";
export async function verifySearchHistory({ browser, origin, channels }) {
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
      await page.goto(origin + "/?view=search");
      const input = page.getByRole("textbox", { name: "搜索内容" });
      await input.fill("uncommitted draft");
      await input.fill("");
      assert.equal(await page.getByTestId("search-history-tag").count(), 0);
      const query = "#" + channels[0].name;
      await input.fill(query);
      await page
        .getByTestId("search-channel-result-" + channels[0].roomId)
        .click();
      await page.waitForURL(
        (u) => u.searchParams.get("room") === channels[0].roomId,
      );
      await page.goto(origin + "/?view=search");
      const tag = page.getByTestId("search-history-tag");
      await tag.waitFor({ timeout: 3000 });
      assert.equal(await tag.count(), 1);
      await page
        .getByTestId("search-common-channel:" + channels[0].roomId)
        .waitFor({ timeout: 3000 });
      await tag.getByRole("button", { name: query, exact: true }).click();
      await page.waitForURL((u) => u.searchParams.get("q") === query);
      await page.waitForFunction(
        (query) => {
          const input = document.querySelector('input[aria-label="搜索内容"]');
          return (
            input?.value === query &&
            document.activeElement === input &&
            input.selectionStart === query.length
          );
        },
        query,
        { timeout: 3000 },
      );
      await input.fill("");
      await tag.waitFor();
      if (width === 390) {
        assert.equal(await tag.getByRole("button").count(), 1);
        await page.getByTestId("search-history-edit-toggle").click();
      } else await tag.hover();
      await tag.getByRole("button").nth(1).click();
      await tag.waitFor({ state: "detached" });
      await page.reload();
      await input.waitFor();
      assert.equal(await tag.count(), 0);
      for (const channel of channels.slice(0, 2)) {
        await input.fill("#" + channel.name);
        await page
          .getByTestId("search-channel-result-" + channel.roomId)
          .click();
        await page.waitForURL(
          (u) => u.searchParams.get("room") === channel.roomId,
        );
        await page.goto(origin + "/?view=search");
        await tag.first().waitFor();
      }
      assert.equal(await tag.count(), 2);
      const frequent = page.locator('[data-testid^="search-common-"]');
      assert.equal(await frequent.count(), 2);
      assert.equal(
        await frequent.first().getAttribute("data-testid"),
        "search-common-channel:" + channels[0].roomId,
        "Two Search opens rank above a single more recent open",
      );
      await frequent.first().click();
      await page.waitForURL(
        (u) => u.searchParams.get("room") === channels[0].roomId,
      );
      await page.goto(origin + "/?view=search");
      await tag.first().waitFor();
      await page.getByRole("button", { name: "清除", exact: true }).click();
      await tag.waitFor({ state: "detached" });
      await page.reload();
      await input.waitFor();
      assert.equal(await tag.count(), 0);
      await frequent.first().waitFor();
      assert.equal(
        await frequent.count(),
        2,
        "Clearing query history does not clear frequent destinations",
      );
      if (width === 1440) {
        await page.getByTestId("app-top-bar-search").click();
        const overlay = page.getByTestId("desktop-search-overlay");
        await overlay
          .getByRole("textbox", { name: "搜索内容" })
          .fill("fixture");
        await overlay.getByTestId("search-view-all-results").click();
        await overlay.waitFor({ state: "detached" });
        await input.fill("");
        await tag.waitFor();
        await tag
          .getByRole("button", { name: "fixture", exact: true })
          .waitFor();
        await page.getByTestId("app-top-bar-search").click();
        await overlay.waitFor();
        assert.equal(
          await overlay.getByTestId("search-history-tag").count(),
          0,
          "Overlay keeps recent conversations, not full-page search history",
        );
      }
      if (width === 1440)
        assert.equal(
          await page
            .getByTestId("desktop-search-overlay")
            .locator('[data-testid^="search-common-"]')
            .count(),
          0,
        );
      assert.deepEqual(errors, []);
      results.push({
        width,
        committedOnly: true,
        persistsAcrossReload: true,
        chooseRunsSearch: true,
        nativeRemove: true,
        clearAllPersists: true,
        overlayCommitAndSeparation: width === 1440,
        noErrors: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
