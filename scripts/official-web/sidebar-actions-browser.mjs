import assert from "node:assert/strict";
// Real temporary Core only; no provider execution.
export async function verifySidebarActions({
  browser,
  origin,
  client,
  workspace,
  channel,
}) {
  const results = [];
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(`${origin}/?room=${channel.roomId}`);
    const surface = page.getByTestId("sidebar-surface");
    await surface.click({ button: "right", position: { x: 3, y: 3 } });
    await page.getByRole("menuitem", { name: "新建频道", exact: true }).click();
    let dialog = page.getByRole("dialog");
    const name = `ContextFlow${viewport.width}`;
    await dialog.getByLabel("名称", { exact: true }).fill(name);
    await dialog.getByRole("button", { name: "创建频道", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const room = (
      await client.request("room.list", { workspaceId: workspace.workspaceId })
    ).rooms.find((r) => r.name === name);
    assert.ok(room);
    const historyBody = `FIXTURE retained content ${viewport.width}`;
    await client.request("message.post", {
      roomId: room.roomId,
      body: historyBody,
      recipients: [],
      idempotencyKey: `archive-history-${viewport.width}`,
      basedOnRoomSeq: (
        await client.request("room.sync", {
          roomId: room.roomId,
          consumerId: "archive-history-test",
        })
      ).latestRoomSeq,
    });

    const row = page.locator(`[data-public-channel-id="${room.roomId}"]`);
    await row.click({ button: "right" });
    assert.equal(
      await page
        .getByRole("menuitem", { name: "移动到分区", exact: true })
        .locator("svg")
        .count(),
      1,
    );
    await page
      .getByRole("menuitem", { name: "移动到分区", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "新建分组", exact: true }).click();
    await dialog
      .getByLabel("名称", { exact: true })
      .fill(`ContextGroup${viewport.width}`);
    await dialog.getByRole("button", { name: "保存分组", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const prefs = async () =>
      (
        await client.request("sidebar.get", {
          workspaceId: workspace.workspaceId,
        })
      ).preferences;
    assert.ok(
      (await prefs()).customSections
        .find((s) => s.name === `ContextGroup${viewport.width}`)
        .items.includes(`room:${room.roomId}`),
    );
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "静音", exact: true }).click();
    await page.waitForFunction(
      (id) =>
        document.querySelector(
          `[data-channel-row="${id}"] [aria-label="已静音"]`,
        ),
      room.roomId,
    );
    assert.ok((await prefs()).mutedActivity.includes(`room:${room.roomId}`));
    await page.reload();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "取消静音", exact: true }).click();
    await page.waitForFunction(
      (id) =>
        !document.querySelector(
          `[data-channel-row="${id}"] [aria-label="已静音"]`,
        ),
      room.roomId,
    );
    assert.ok(!(await prefs()).mutedActivity.includes(`room:${room.roomId}`));
    // Empty/own-only channels never fabricate unread. Verify the exact native mark operation.
    const marks = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/activity/mark")) marks.push(r.postDataJSON());
    });
    await row.click({ button: "right" });
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/activity/mark") && r.status() === 200,
      ),
      page.getByRole("menuitem", { name: "标记未读", exact: true }).click(),
    ]);
    assert.equal(marks.length, 1);
    assert.equal(marks[0].action, "unread");
    await page.route("**/v3/client/activity/mark", async (route) => {
      await route.fetch();
      await route.abort();
    });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "标记未读", exact: true }).click();
    await page
      .getByText("读状态未确认或已变化，未自动重发。请刷新检查当前状态。", {
        exact: true,
      })
      .waitFor();
    await page.getByRole("button", { name: "刷新列表", exact: true }).click();
    await page.waitForResponse((r) => r.url().endsWith("/sidebar/get"));
    assert.equal(marks.length, 2, "lost mark is never retried by refresh");
    await page.unroute("**/v3/client/activity/mark");
    // Lost archive reply must replay the exact mutation; active selection becomes read-only.
    const archives = [];
    let lost = false;
    await page.route("**/v3/client/rooms/archive", async (route) => {
      archives.push(route.request().postDataJSON());
      if (!lost) {
        lost = true;
        await route.fetch();
        await route.abort();
      } else await route.continue();
    });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "归档", exact: true }).click();
    await dialog.getByRole("button", { name: "确认归档", exact: true }).click();
    await dialog.getByRole("button", { name: "核实操作结果" }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(archives.length, 2);
    assert.deepEqual(archives[0], archives[1]);
    await page.getByText("频道已归档，历史只读。", { exact: true }).waitFor();
    assert.equal(await row.count(), 0);
    await page.getByText(historyBody, { exact: true }).waitFor();
    const sends = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/messages/post")) sends.push(r.url());
    });
    await page.locator("textarea").fill("must not send in archived room");
    assert.equal(
      await page.locator('button[type="submit"]').isDisabled(),
      true,
    );
    await page.locator("textarea").press("Enter");
    assert.equal(sends.length, 0);

    await page.reload();
    await page.getByText("频道已归档，历史只读。", { exact: true }).waitFor();
    await page.getByText(historyBody, { exact: true }).waitFor();
    await surface.click({ button: "right", position: { x: 3, y: 3 } });
    await page
      .getByRole("menuitem", { name: "已归档频道", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: `恢复 ${name}`, exact: true })
      .click();
    await row.waitFor();
    assert.ok(
      !(
        await client.request("room.list", {
          workspaceId: workspace.workspaceId,
        })
      ).rooms.find((r) => r.roomId === room.roomId).archivedAt,
    );
    await page
      .getByText("频道已归档，历史只读。", { exact: true })
      .waitFor({ state: "hidden" });
    await page.locator("textarea").fill("restored writable draft");
    await page.locator('button[type="submit"]:enabled').waitFor();
    await page.locator("textarea").fill("");
    // Restoring a channel creates a real durable unread notice, even for its owner.
    const marker = page.locator(
      `[data-channel-row="${room.roomId}"] [aria-label="有未读消息"]`,
    );
    await marker.waitFor();
    assert.equal(await marker.getAttribute("data-slot"), "sidebar-item-count");
    assert.match(await marker.innerText(), /^\d+\+?$/);
    assert.equal(
      await marker.evaluate((el) => !!el.closest("[data-public-channel-id]")),
      true,
    );
    await row.click({ button: "right" });
    await page.keyboard.press("Escape");
    await row.click();
    await marker.waitFor({ state: "hidden" });
    await page.reload();
    await row.waitFor();
    assert.equal(await marker.count(), 0);
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "标记未读", exact: true }).click();
    await marker.waitFor();
    await page.reload();
    await marker.waitFor();
    const head = (
      await client.request("room.sync", {
        roomId: room.roomId,
        consumerId: "archive-busy-test",
      })
    ).latestRoomSeq;
    await client.request("task.create", {
      roomId: room.roomId,
      title: "FIXTURE active work blocks archive",
      basedOnRoomSeq: head,
      idempotencyKey: `archive-busy-${viewport.width}`,
    });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "归档", exact: true }).click();
    await dialog.getByRole("button", { name: "确认归档", exact: true }).click();
    await dialog
      .getByRole("alert")
      .filter({ hasText: "active collaboration work" })
      .waitFor();
    assert.ok(
      !(
        await client.request("room.list", {
          workspaceId: workspace.workspaceId,
        })
      ).rooms.find((r) => r.roomId === room.roomId).archivedAt,
    );
    await context.close();
    results.push({
      viewport,
      blankMenu: true,
      moveSubmenuAndCreate: true,
      mutePersists: true,
      markUsesApi: true,
      unreadReadPersists: true,
      lostMarkNeverReplays: true,
      activeWorkRefusesArchive: true,
      archiveUnknownReplay: true,
      archiveReadOnlyReloadAndRestore: true,
    });
  }
  return results;
}
