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
      let releaseInitial;
      const initialRead = new Promise((resolve) => {
        releaseInitial = resolve;
      });
      await page.route("**/v3/client/activity/list", async (route) => {
        const request = route.request().postDataJSON();
        const cursor = request?.cursor;
        requests.push(cursor ?? null);
        if (request?.filter === "mentions" && !cursor) await initialRead;
        await new Promise((resolve) => setTimeout(resolve, 100));
        await route.fulfill({
          json: {
            ...snapshot,
            items:
              request?.filter === "unread"
                ? []
                : items.map((item) => ({
                    ...item,
                    key: (cursor ? "page2-" : "") + item.key,
                  })),
            nextCursor:
              cursor || request?.filter === "unread"
                ? undefined
                : "fixture-page2",
          },
        });
      });
      const sourceUrl = origin + "/?view=activity&af=mentions";
      await page.goto(sourceUrl);
      const list = page.getByTestId("discovery-results");
      try {
        await list.locator('[aria-busy="true"]').waitFor({ timeout: 3000 });
      } finally {
        releaseInitial();
      }
      await page.locator('[data-result-id="fixture-return-19"]').waitFor();
      assert.equal(
        await page.getByRole("button", { name: "下一页", exact: true }).count(),
        0,
        "Native activity has no page buttons",
      );
      await list.hover();
      await page.mouse.wheel(0, 4000);
      const row = page.locator('[data-result-id="page2-fixture-return-10"]');
      await row.scrollIntoViewIfNeeded();
      assert.equal(
        await page.locator('[data-result-id="fixture-return-0"]').count(),
        1,
        "Loading more retains the first page",
      );
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
      const filterLoaded = page.waitForResponse(
        (r) =>
          r.url().endsWith("/v3/client/activity/list") &&
          r.request().postDataJSON()?.filter === "all",
      );
      await page.getByTestId("inbox-filter-all").click();
      await filterLoaded;
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
      await page.getByTestId("inbox-filter-unread").click();
      await list
        .locator('[data-slot="empty-state"]')
        .waitFor({ timeout: 3000 });
      assert.equal(await list.locator("[data-result-id]").count(), 0);
      const geometry = await list.evaluate((el) => ({
        padding: getComputedStyle(el).padding,
        childCount: el.querySelectorAll('[data-slot="empty-state"]').length,
      }));
      assert.equal(geometry.padding, "16px");
      assert.equal(geometry.childCount, 1);
      assert.deepEqual(errors, []);
      results.push({
        width,
        sourceFilterRetained: true,
        filterChangeResetsPosition: true,
        singleHistoryEntry: true,
        scrollRestoredAfterAsyncLoad: true,
        loadedWindowRestoredByFreshReads: true,
        nativeScrollContinuation: true,
        firstPageRetained: true,
        nativeSkeletonAndEmptyState: true,
        nativeViewportPadding: true,
        filterChangeResetsPage: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
