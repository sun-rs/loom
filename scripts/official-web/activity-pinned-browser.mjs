import assert from "node:assert/strict";
export async function verifyActivityPinned({
  browser,
  origin,
  client,
  workspace,
  head,
}) {
  const rooms = [];
  for (const suffix of ["old", "new"]) {
    const { room } = await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      name: `FIXTURE pin ${suffix}`,
      slug: `fixture-pin-${suffix}`,
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: `pin-room-${suffix}`,
    });
    rooms.push(room);
    await client.request("message.post", {
      roomId: room.roomId,
      body: `FIXTURE pin ${suffix}`,
      recipients: [],
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: `pin-message-${suffix}`,
    });
  }
  const patch = async (pinned) => {
    const { preferences } = await client.request("sidebar.get", {
      workspaceId: workspace.workspaceId,
    });
    await client.request("sidebar.patch", {
      workspaceId: workspace.workspaceId,
      expectedVersion: preferences.version,
      idempotencyKey: `pin-${preferences.version}`,
      patch: { pinned },
    });
  };
  const results = [];
  for (const width of [1440, 390]) {
    await patch([`room:${rooms[0].roomId}`]);
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 1,
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    try {
      const page = await context.newPage(),
        errors = [],
        writes = [];
      page.setDefaultTimeout(10000);
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (/\/activity\/(mark|follow)$/.test(r.url())) writes.push(r.url());
      });
      await page.goto(origin + "/?view=activity");
      const list = page.getByTestId("discovery-results");
      await list.getByText("已置顶", { exact: true }).waitFor();
      await list.getByText("全部会话", { exact: true }).waitFor();
      assert.equal(
        await list
          .getByTestId("inbox-row")
          .first()
          .getAttribute("data-result-id"),
        `channel:${rooms[0].roomId}`,
      );
      await page.screenshot({ path: `/tmp/loom-activity-pinned-${width}.png` });
      await patch([]);
      await page.getByRole("button", { name: "刷新动态", exact: true }).click();
      await list
        .getByText("已置顶", { exact: true })
        .waitFor({ state: "hidden" });
      await list.getByTestId("inbox-row").first().waitFor();
      assert.equal(
        await list
          .getByTestId("inbox-row")
          .first()
          .getAttribute("data-result-id"),
        `channel:${rooms[1].roomId}`,
      );
      await page.route("**/v3/client/sidebar/get", (route) => route.abort());
      await page.getByRole("button", { name: "刷新动态", exact: true }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "置顶分组读取失败" })
        .waitFor();
      await list.getByTestId("inbox-row").first().waitFor();
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, []);
      results.push({
        width,
        realSidebarPreferences: true,
        pinnedFirst: true,
        unpinRefresh: true,
        failedReadKeepsFeed: true,
        noActivityWrites: true,
        pageErrors: errors,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
