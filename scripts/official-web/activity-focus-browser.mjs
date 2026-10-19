import { showChatList } from "./mobile-chat-browser.mjs";
import assert from "node:assert/strict";
export async function verifyActivityFocus({
  browser,
  origin,
  client,
  channel,
  otherChannel,
  head,
}) {
  await client.request("message.post", {
    roomId: channel.roomId,
    body: "FIXTURE first unread focus",
    recipients: [],
    basedOnRoomSeq: await head(channel.roomId),
    idempotencyKey: "activity-focus-fixture",
  });
  await client.request("message.post", {
    roomId: otherChannel.roomId,
    body: "FIXTURE next unread focus",
    recipients: [],
    basedOnRoomSeq: await head(otherChannel.roomId),
    idempotencyKey: "activity-next-focus-fixture",
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
          unreadCount: index < 2 ? unread : 0,
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
        unread = 2;
        await page
          .getByRole("button", { name: "刷新动态", exact: true })
          .click();
        await row.waitFor();
        const title = page.getByTestId("inbox-header-title");
        const active = page.locator(
          '[data-testid="inbox-row"][data-active="true"]',
        );
        await title.dblclick();
        await active.waitFor();
        const first = await active.getAttribute("data-result-id");
        await title.dblclick();
        await page.waitForFunction(
          (id) =>
            document
              .querySelector('[data-testid="inbox-row"][data-active="true"]')
              ?.getAttribute("data-result-id") !== id,
          first,
        );
        assert.deepEqual(writes, []);
        assert.deepEqual(errors, []);
        results.push({
          width,
          mobileSingleClickPreserved: true,
          noImplicitFocus: true,
          titleCyclesUnread: true,
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
      const activeRow = page.locator(
        '[data-testid="inbox-row"][data-active="true"]',
      );
      const firstId = await activeRow.getAttribute("data-result-id");
      const title = page.getByTestId("inbox-header-title");
      const readCountBeforeTitle = reads;
      await title.dblclick();
      await page.waitForFunction(
        (id) =>
          document
            .querySelector('[data-testid="inbox-row"][data-active="true"]')
            ?.getAttribute("data-result-id") !== id,
        firstId,
      );
      const secondId = await activeRow.getAttribute("data-result-id");
      assert.notEqual(secondId, firstId);
      await title.dblclick();
      await page.waitForFunction(
        (id) =>
          document
            .querySelector('[data-testid="inbox-row"][data-active="true"]')
            ?.getAttribute("data-result-id") === id,
        firstId,
      );
      assert.equal(
        reads,
        readCountBeforeTitle,
        "title focus does not reload or fetch history",
      );
      assert.deepEqual(writes, []);
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
        titleCyclesUnreadWithoutReadsOrWrites: true,
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
