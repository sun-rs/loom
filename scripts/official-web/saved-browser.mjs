import assert from "node:assert/strict";
export async function verifySaved({
  browser,
  origin,
  channels,
  client,
  workspace,
  head,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      isMobile: width === 390,
      hasTouch: width === 390,
      locale: "zh-CN",
    });
    try {
      const page = await context.newPage(),
        errors = [];
      page.setDefaultTimeout(12000);
      page.on("pageerror", (e) => errors.push(e.message));
      let targetText = "FIXTURE history 53",
        threadRoot;
      if (process.env.LOOM_SAVED_THREAD === "1") {
        const root = (
          await client.request("message.list", {
            roomId: channels[0].roomId,
            limit: 50,
          })
        ).messages.find(
          (m) => m.body === "FIXTURE history " + (width === 1440 ? 51 : 52),
        );
        threadRoot = root.messageId;
        const { thread } = await client.request("thread.create", {
          roomId: channels[0].roomId,
          rootMessageId: threadRoot,
          recipientIds: [],
          basedOnRoomSeq: await head(channels[0].roomId),
          idempotencyKey: "saved-thread-" + width,
        });
        targetText = "FIXTURE saved thread " + width;
        await client.request("thread.reply", {
          roomId: channels[0].roomId,
          threadId: thread.threadId,
          body: targetText,
          recipientIds: [],
          basedOnRoomSeq: await head(channels[0].roomId),
          idempotencyKey: "saved-reply-" + width,
        });
      }
      await page.goto(
        origin +
          "/?room=" +
          channels[0].roomId +
          (threadRoot ? "&thread=" + threadRoot : ""),
      );
      const row = page
        .locator("[data-timeline-message-id]")
        .filter({ hasText: targetText })
        .first();
      await row.waitFor();
      const id = await row.getAttribute("data-timeline-message-id");
      if (width === 1440) {
        await row.hover();
        await row.locator('[data-message-affordance="bookmark"]').waitFor();
      } else {
        await row.scrollIntoViewIfNeeded();
        const cdp = await context.newCDPSession(page);
        await page.waitForTimeout(500);
        // Native selectable text owns text selection; long-press menus belong
        // to the surrounding message surface. Pick an actual visible hit target.
        const point = await row
          .locator('[data-slot="message-item"]')
          .first()
          .evaluate((el) => {
            const r = el.getBoundingClientRect();
            for (
              let y = Math.max(1, r.top + 2);
              y < Math.min(innerHeight, r.bottom - 1);
              y += 4
            ) {
              for (const x of [r.right - 3, r.left + 3, r.left + r.width / 2]) {
                const hit = document.elementFromPoint(x, y);
                if (
                  hit &&
                  el.contains(hit) &&
                  !hit.closest(
                    "[data-message-selectable='true'],button,a,[data-avatar-context]",
                  )
                )
                  return { x, y };
              }
            }
            return null;
          });
        assert.ok(point, "visible non-selectable message surface must exist");
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [point],
        });
        await page.waitForTimeout(650);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      }
      let original;
      await page.route("**/v3/client/messages/save", async (route) => {
        original = route.request().postDataJSON();
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort();
      });
      if (width === 1440)
        await row.locator('[data-message-affordance="bookmark"]').click();
      else {
        try {
          await page.getByText("收藏消息", { exact: true }).click();
        } catch (error) {
          await page.screenshot({ path: "/tmp/loom-saved-touch-failure.png" });
          throw error;
        }
      }
      await page
        .getByText(/结果未知/)
        .first()
        .waitFor();
      await page.unroute("**/v3/client/messages/save");
      const replay = page.waitForRequest((r) =>
        r.url().endsWith("/messages/save"),
      );
      await page.getByRole("button", { name: "核实收藏结果" }).click();
      assert.deepEqual((await replay).postDataJSON(), original);
      await page
        .getByText(/结果未知/)
        .first()
        .waitFor({ state: "detached" });
      assert.equal(
        (
          await client.request("message.social", {
            roomId: channels[0].roomId,
            messageIds: [id],
          })
        ).items[0].saved,
        true,
      );
      if (width === 390 && threadRoot)
        await page.getByTestId("thread-mobile-back").click();
      if (width === 390)
        await page
          .getByRole("button", { name: "聊天列表", exact: true })
          .click();
      await page.getByTestId("sidebar-saved-entry").click();
      await page.getByTestId("saved-list-scroller").waitFor();
      assert.equal(
        await page
          .locator('[data-slot="panel-header"] [data-slot="panel-header-icon"]')
          .count(),
        0,
      );

      const card = page
        .getByTestId("saved-list-scroller")
        .getByRole("button")
        .filter({ hasText: targetText })
        .first();
      await card.waitFor();
      await page.reload();
      await card.waitFor();
      await card.click();
      await page.waitForURL(
        (url) =>
          url.searchParams.get("message") === id &&
          !url.searchParams.has("saved"),
      );
      await page.locator(`[data-timeline-message-id="${id}"]`).waitFor();
      if (width === 390 && threadRoot)
        await page.getByTestId("thread-mobile-back").click();
      if (width === 390)
        await page
          .getByRole("button", { name: "聊天列表", exact: true })
          .click();
      await page.getByTestId("sidebar-saved-entry").click();
      await card.waitFor();
      await page.screenshot({ path: `/tmp/loom-saved-${width}.png` });
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/messages/save") && r.status() === 200,
      );
      await card.getByRole("button").click();
      await response;
      await card.waitFor({ state: "detached" });
      assert.equal(
        (
          await client.request("message.saved", {
            workspaceId: workspace.workspaceId,
            limit: 20,
            sortDirection: "desc",
          })
        ).total,
        0,
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        thread: !!threadRoot,
        save: true,
        exactReplay: true,
        refresh: true,
        jump: true,
        remove: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
