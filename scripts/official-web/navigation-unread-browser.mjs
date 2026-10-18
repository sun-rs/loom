import assert from "node:assert/strict";
export async function verifyNavigationUnread({ browser, origin }) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
  });
  try {
    const page = await context.newPage();
    let summary = {
      unreadActivityCount: 1,
      rooms: [{ roomId: "fixture", unreadCount: 2, hasMention: false }],
    };
    let fail = false;
    await page.route("**/v3/client/activity/list", async (route) => {
      if (fail)
        return route.fulfill({ status: 503, body: "FIXTURE unavailable" });
      const response = await route.fetch();
      const body = await response.json();
      return route.fulfill({ response, json: { ...body, summary } });
    });
    const dot = (id) =>
      page
        .getByTestId("left-rail-tab-" + id)
        .locator('[data-slot="app-rail-item-indicator"]');
    await page.goto(origin + "/?view=settings");
    await dot("channels").waitFor();
    await dot("activity").waitFor();
    assert.equal(
      await page
        .getByTestId("left-rail-tab-channels")
        .locator('[data-slot="app-rail-item-icon"] > svg')
        .count(),
      1,
    );
    await page.getByTestId("left-rail-tab-activity").click();
    await dot("activity").waitFor({ state: "detached" });
    assert.equal(await dot("channels").count(), 1);
    summary = {
      unreadActivityCount: 0,
      rooms: [{ roomId: "fixture", unreadCount: 2, hasMention: false }],
    };
    await page.goto(origin + "/?view=settings");
    await dot("channels").waitFor();
    assert.equal(await dot("activity").count(), 0);
    fail = true;
    await page.reload();
    await page
      .getByText("频道列表设置读取失败，请重试。", { exact: true })
      .waitFor({ state: "attached" });
    assert.equal(await dot("channels").count(), 0);
    assert.equal(await dot("activity").count(), 0);
    console.log(
      JSON.stringify({
        canonicalSummary: true,
        independentCounts: true,
        activeDotHidden: true,
        noDuplicateIcon: true,
        readFailureClears: true,
      }),
    );
  } finally {
    await context.close();
  }
}
