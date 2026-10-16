import assert from "node:assert/strict";
export async function verifyActivityReturn({
  browser,
  origin,
  client,
  workspace,
}) {
  const snapshot = await client.request("activity.list", {
    workspaceId: workspace.workspaceId,
    limit: 20,
  });
  const source = snapshot.items.find((item) => item.latestMessage);
  assert.ok(source);
  // Presentation-only long-list fixture; destinations remain real temporary-Core messages.
  const items = Array.from({ length: 20 }, (_, n) => ({
    ...source,
    key: `fixture-return-${n}`,
  }));
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/v3/client/activity/list", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await route.fulfill({
          json: { ...snapshot, items, nextCursor: undefined },
        });
      });
      const sourceUrl = origin + "/?view=activity&af=mentions";
      await page.goto(sourceUrl);
      const row = page.locator('[data-result-id="fixture-return-10"]');
      await row.scrollIntoViewIfNeeded();
      const list = page.getByTestId("discovery-results");
      const before = await list.evaluate((el) => el.scrollTop);
      assert.ok(before > 300);
      if (width === 1440) await row.dblclick();
      else await row.click();
      await page.waitForURL((u) => !u.searchParams.has("view"));
      await page
        .locator(
          `[data-timeline-message-id="${source.latestMessage.messageId}"] [data-highlighted="true"]`,
        )
        .waitFor();
      await page.goBack();
      assert.equal(
        page.url(),
        sourceUrl,
        "One gesture writes one history entry and retains the source filter",
      );
      await row.waitFor();
      await page.waitForFunction(
        (expected) =>
          Math.abs(
            document.querySelector('[data-testid="discovery-results"]')
              .scrollTop - expected,
          ) < 2,
        before,
        { timeout: 3000 },
      );
      await page.getByTestId("inbox-filter-all").click();
      await page.waitForURL((u) => u.searchParams.get("af") === "all");
      await row.waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="discovery-results"]')
            ?.scrollTop === 0,
        undefined,
        { timeout: 3000 },
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        sourceFilterRetained: true,
        filterChangeResetsPosition: true,
        singleHistoryEntry: true,
        scrollRestoredAfterAsyncLoad: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
