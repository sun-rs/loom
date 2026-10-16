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
      const requests = [];
      await page.route("**/v3/client/activity/list", async (route) => {
        const cursor = route.request().postDataJSON()?.cursor;
        requests.push(cursor ?? null);
        await new Promise((resolve) => setTimeout(resolve, 100));
        await route.fulfill({
          json: {
            ...snapshot,
            items: items.map((item) => ({
              ...item,
              key: (cursor ? "page2-" : "") + item.key,
            })),
            nextCursor: cursor ? undefined : "fixture-page2",
          },
        });
      });
      const sourceUrl = origin + "/?view=activity&af=mentions";
      await page.goto(sourceUrl);
      await page.getByRole("button", { name: "下一页", exact: true }).click();
      const row = page.locator('[data-result-id="page2-fixture-return-10"]');
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
      await row.waitFor({ timeout: 3000 });
      assert.equal(
        requests.at(-1),
        "fixture-page2",
        "Return refetches the previously visited page",
      );
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
      await page.locator('[data-result-id="fixture-return-10"]').waitFor();
      assert.equal(requests.at(-1), null, "Filter change resets the page");
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
        pageWindowRestoredByFreshRead: true,
        filterChangeResetsPage: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
