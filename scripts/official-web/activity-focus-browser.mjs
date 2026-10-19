import { showChatList } from "./mobile-chat-browser.mjs";
import assert from "node:assert/strict";
export async function verifyActivityFocus({
  browser,
  origin,
  client,
  channel,
  head,
}) {
  await client.request("message.post", {
    roomId: channel.roomId,
    body: "FIXTURE first unread focus",
    recipients: [],
    basedOnRoomSeq: await head(channel.roomId),
    idempotencyKey: "activity-focus-fixture",
  });
  const results = [];
  for (const width of [1440, 900, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      let unread = 0;
      let reads = 0;
      const writes = [],
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (req) => {
        if (/\/activity\/(mark|follow)$/.test(new URL(req.url()).pathname))
          writes.push(req.url());
      });
      await page.route("**/v3/client/activity/list", async (route) => {
        reads++;
        const response = await route.fetch(),
          body = await response.json();
        body.items = body.items.map((item, index) => ({
          ...item,
          unreadCount: index === 0 ? unread : 0,
        }));
        await route.fulfill({ response, json: body });
      });
      await page.goto(origin + "/?view=activity");
      const row = page.getByTestId("inbox-row").first();
      await row.waitFor();
      if (width === 390) {
        await page.goto(origin + "/?view=channels");
        await showChatList(page);
        await page.getByTestId("mobile-home-activity-entry").click();
        await row.waitFor();
        assert.equal(new URL(page.url()).searchParams.get("view"), "activity");
        assert.equal(
          await page
            .locator('[data-testid="inbox-row"][data-active="true"]')
            .count(),
          0,
        );
        assert.deepEqual(writes, []);
        assert.deepEqual(errors, []);
        results.push({
          width,
          mobileSingleClickPreserved: true,
          noImplicitFocus: true,
        });
        continue;
      }
      const rail = page.getByTestId("left-rail-tab-activity");
      const beforeFocusReads = reads;
      await Promise.all([
        page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === "/v3/client/activity/list",
        ),
        rail.dblclick(),
      ]);
      await row.waitFor();
      assert.ok(reads > beforeFocusReads, "double-click refreshes the inbox");
      assert.equal(
        await page
          .locator('[data-testid="inbox-row"][data-active="true"]')
          .count(),
        0,
      );
      // Pending intent resolves on the next loaded update, without a second gesture.
      unread = 2;
      await page.getByRole("button", { name: "刷新动态", exact: true }).click();
      await page
        .locator('[data-testid="inbox-row"][data-active="true"]')
        .waitFor();
      assert.equal(new URL(page.url()).searchParams.has("message"), false);
      assert.equal(new URL(page.url()).searchParams.has("thread"), false);
      assert.deepEqual(writes, []);
      await page.screenshot({ path: `/tmp/loom-activity-focus-${width}.png` });
      await page.waitForTimeout(3200);
      assert.equal(await row.getAttribute("data-active"), null);
      await rail.dblclick();
      await page
        .locator('[data-testid="inbox-row"][data-active="true"]')
        .waitFor();
      await page.getByTestId("left-rail-tab-settings").click();
      await rail.click();
      await row.waitFor();
      assert.equal(await row.getAttribute("data-active"), null);
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      results.push({
        width,
        pendingUntilUnread: true,
        repeatedGesture: true,
        highlightExpires: true,
        exitClearsIntent: true,
        noReadOrFollowWrites: true,
        noDetailNavigation: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
