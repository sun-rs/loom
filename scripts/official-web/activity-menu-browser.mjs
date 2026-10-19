import assert from "node:assert/strict";
export async function verifyActivityMenu({
  browser,
  origin,
  client,
  workspace,
  head,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const { room } = await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      kind: "channel",
      name: `FIXTURE activity menu ${width}`,
      slug: `fixture-menu-${width}`,
      idempotencyKey: `menu-room-${width}`,
    });
    const append = async (suffix) =>
      client.request("message.post", {
        roomId: room.roomId,
        body: `FIXTURE menu ${suffix}`,
        recipients: [],
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: `menu-${width}-${suffix}`,
      });
    await append("first");
    const snapshot = await client.request("activity.list", {
      workspaceId: workspace.workspaceId,
      limit: 100,
    });
    const item = snapshot.items.find((i) => i.roomId === room.roomId);
    assert.ok(item);
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      deviceScaleFactor: 1,
      locale: "zh-CN",
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    try {
      const page = await context.newPage(),
        writes = [],
        errors = [];
      let unread = 1,
        dropDone = false;
      page.on("pageerror", (e) => errors.push(e.message));
      // Only peer unread rendering is simulated; all writes and receipts use the temporary real Kernel.
      await page.route("**/v3/client/activity/list", async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        for (const row of data.items ?? [])
          if (row.roomId === room.roomId) row.unreadCount = unread;
        await route.fulfill({ response, json: data });
      });
      await page.route("**/v3/client/activity/mark", async (route) => {
        const request = route.request().postDataJSON();
        const response = await route.fetch();
        const data = await response.json();
        writes.push({ request, status: response.status(), data });
        if (response.ok()) unread = request.action === "unread" ? 1 : 0;
        if (dropDone && request.action === "done") await route.abort("failed");
        else await route.fulfill({ response });
      });
      await page.goto(origin + "/?view=activity");
      const row = page.locator(`[data-result-id="${item.key}"]`);
      await row.waitFor();
      const menu = page.getByTestId("activity-context-menu");
      await row.click({ button: "right" });
      await menu.waitFor();
      const bounds = await menu.boundingBox();
      assert.ok(
        bounds.x >= 0 &&
          bounds.x + bounds.width <= width &&
          bounds.y >= 0 &&
          bounds.y + bounds.height <= 844,
      );
      // Release xA ContextMenuPopup recipe has min-w-60, overriding je width:184.
      assert.equal(Math.round(bounds.width), 240);
      await page.screenshot({
        animations: "disabled",
        path: `/tmp/loom-activity-menu-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "hidden" });
      await row.focus();
      await page.keyboard.press("Shift+F10");
      await menu.waitFor();
      await page
        .locator('[data-slot="dismiss-backdrop"]')
        .click({ position: { x: 2, y: 2 } });
      await menu.waitFor({ state: "hidden" });
      assert.equal(writes.length, 0);
      await row.click({ button: "right" });
      await menu.getByRole("menuitem").first().click();
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="activity-context-menu"]'),
      );
      await row
        .locator('[data-testid="conversation-card-new-badge"]')
        .waitFor({ state: "hidden" });
      assert.equal(writes[0].request.action, "read");
      assert.equal(writes[0].request.throughSeq, item.latestSeq);
      assert.equal(writes[0].data.doneThroughSeq, 0);
      assert.equal(writes[0].data.readThroughSeq, item.latestSeq);
      assert.equal(new URL(page.url()).searchParams.get("view"), "activity");
      assert.equal(new URL(page.url()).searchParams.has("message"), false);
      // A stale unread action must fail and refresh, never silently acknowledge new content.
      await row.click({ button: "right" });
      await menu.waitFor();
      await append("newer");
      await menu.getByRole("menuitem").first().click();
      await page
        .getByRole("alert")
        .filter({ hasText: "不会自动重发" })
        .waitFor();
      assert.equal(writes[1].request.action, "unread");
      assert.ok(writes[1].status >= 400);
      assert.equal(writes.length, 2);
      await row.getByText("FIXTURE menu newer", { exact: false }).waitFor();
      dropDone = true;
      await row.click({ button: "right" });
      await menu.getByRole("menuitem").last().click();
      await row.waitFor({ state: "hidden" });
      assert.equal(writes.filter((w) => w.request.action === "done").length, 1);
      assert.equal(writes.at(-1).status, 200);
      assert.ok(writes.at(-1).request.throughSeq > item.latestSeq);
      const after = await client.request("activity.list", {
        workspaceId: workspace.workspaceId,
        limit: 100,
      });
      assert.ok(!after.items.some((i) => i.roomId === room.roomId));
      // Threads retain Done, but omit read/follow controls until the projection
      // exposes official follow-state semantics. Never apply a thread action to its parent.
      dropDone = false;
      const { thread } = await client.request("thread.create", {
        roomId: room.roomId,
        rootMessageId: item.latestMessage.messageId,
        recipientIds: [],
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: `menu-thread-${width}`,
      });
      await client.request("thread.reply", {
        roomId: room.roomId,
        threadId: thread.threadId,
        body: "FIXTURE menu thread",
        recipientIds: [],
        basedOnRoomSeq: await head(room.roomId),
        idempotencyKey: `menu-thread-reply-${width}`,
      });
      const threads = await client.request("activity.list", {
        workspaceId: workspace.workspaceId,
        limit: 100,
      });
      const threadItem = threads.items.find(
        (i) => i.threadId === thread.threadId,
      );
      assert.ok(threadItem);
      await page.reload();
      const threadRow = page.locator(`[data-result-id="${threadItem.key}"]`);
      await threadRow.waitFor();
      await threadRow.click({ button: "right" });
      await menu.waitFor();
      assert.equal(await menu.getByRole("menuitem").count(), 1);
      await menu.getByRole("menuitem").click();
      await threadRow.waitFor({ state: "hidden" });
      assert.equal(writes.at(-1).request.threadId, thread.threadId);
      assert.equal(writes.at(-1).request.action, "done");
      assert.deepEqual(errors, []);
      results.push({
        width,
        readDoesNotComplete: true,
        staleUnreadRejected: true,
        unknownDoneNotResent: true,
        officialMenuBounds: true,
        keyboardAndDismiss: true,
        noAccidentalNavigation: true,
        threadDoneScope: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
