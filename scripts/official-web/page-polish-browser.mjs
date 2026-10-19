import assert from "node:assert/strict";
export async function verifyPagePolish({
  browser,
  origin,
  channels,
  client,
  workspace,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${origin}/?room=${channels[2].roomId}`);
    await page.getByTestId("loom-channel-control-trigger").click();
    const sheet = page.getByTestId("loom-channel-control-sheet");
    await sheet.getByTestId("loom-channel-members").waitFor();
    assert.equal(
      await sheet.getByRole("button", { name: "关闭频道设置" }).count(),
      0,
    );
    assert.equal(
      await sheet
        .getByRole("textbox", { name: "名称", exact: false })
        .evaluate((e) => e === document.activeElement),
      false,
    );
    assert.equal(
      await sheet
        .getByTestId("loom-channel-members")
        .evaluate((e) => getComputedStyle(e).borderTopWidth),
      "0px",
    );
    await sheet.getByRole("button", { name: "取消", exact: true }).click();
    await page.goto(`${origin}/?view=agents`);
    await page.locator("[data-role-id]").first().click();
    const tab = page.getByRole("tab", { name: "配置", exact: true });
    await tab.click();
    const rect = await tab.boundingBox();
    assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= width);
    assert.equal(
      await tab.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return e.contains(
          document.elementFromPoint(r.x + 2, r.y + r.height / 2),
        );
      }),
      true,
    );
    await page
      .getByTestId("role-presence")
      .first()
      .waitFor({ state: "attached" });
    const snapshot = await client.request("activity.list", {
      workspaceId: workspace.workspaceId,
      limit: 100,
    });
    const target = snapshot.items.find((i) => i.roomId === channels[0].roomId);
    assert.ok(target);
    // Simulate peer unread presentation only; mutation still reaches the temporary Kernel.
    let unread = 1;
    await page.route("**/v3/client/activity/list", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.summary = { ...data.summary, unreadActivityCount: unread };
      if (route.request().postDataJSON().filter === "unread") {
        data.items = unread ? [{ ...target, unreadCount: 1 }] : [];
        data.total = data.items.length;
        delete data.nextCursor;
      }
      await route.fulfill({ response, json: data });
    });
    await page.route("**/v3/client/activity/mark", async (route) => {
      const response = await route.fetch();
      if (response.ok()) unread = 0;
      await route.fulfill({ response });
    });
    await page.goto(`${origin}/?view=activity`);
    await page.getByRole("button", { name: "全部已读", exact: true }).waitFor();
    await page.getByRole("button", { name: "刷新动态", exact: true }).click();
    await page.getByText(/条进行中/).waitFor();
    const mark = page.waitForRequest(
      (r) =>
        r.url().endsWith("/activity/mark") &&
        r.postDataJSON().action === "read",
    );
    await page.getByRole("button", { name: "全部已读", exact: true }).click();
    const payload = (await mark).postDataJSON();
    assert.equal(payload.throughSeq, target.latestSeq);
    await page.getByText(/0 条未读/).waitFor();
    assert.equal(
      (
        await client.request("activity.list", {
          workspaceId: workspace.workspaceId,
          filter: "unread",
          limit: 100,
        })
      ).total,
      0,
    );
    await page.goto(`${origin}/?view=computers`);
    if (width < 768) await page.getByTestId("computer-mobile-row").click();
    await page.getByTestId("computer-instances").waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    results.push({
      width,
      fixture: true,
      drawer: true,
      roleTabsHitTest: true,
      activityHeader: true,
      computerInstances: true,
    });
    await context.close();
  }
  return results;
}
