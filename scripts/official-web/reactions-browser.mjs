import assert from "node:assert/strict";
export async function verifyReactions({
  browser,
  origin,
  channels,
  client,
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
      page.on("pageerror", (e) => errors.push(e.message));
      let thread;
      if (process.env.LOOM_REACTION_THREAD === "1") {
        const root = (
          await client.request("message.list", {
            roomId: channels[0].roomId,
            limit: 50,
          })
        ).messages.find(
          (m) => m.body === "FIXTURE history " + (width === 1440 ? 53 : 52),
        );
        thread = (
          await client.request("thread.create", {
            roomId: channels[0].roomId,
            rootMessageId: root.messageId,
            recipientIds: [],
            basedOnRoomSeq: await head(channels[0].roomId),
            idempotencyKey: "reaction-thread-" + width,
          })
        ).thread;
        await client.request("thread.reply", {
          roomId: channels[0].roomId,
          threadId: thread.threadId,
          body: "FIXTURE reaction reply " + width,
          recipientIds: [],
          basedOnRoomSeq: await head(channels[0].roomId),
          idempotencyKey: "reaction-reply-" + width,
        });
        await page.goto(
          origin + "/?room=" + channels[0].roomId + "&thread=" + root.messageId,
        );
      } else await page.goto(origin + "/?room=" + channels[0].roomId);
      const row = page
        .locator("[data-timeline-message-id]")
        .filter({
          hasText: thread
            ? "FIXTURE reaction reply " + width
            : "FIXTURE history 53",
        })
        .first();
      await row.waitFor();
      const id = await row.getAttribute("data-timeline-message-id");

      if (width === 1440) {
        await row.hover();
        await row
          .locator('[data-message-affordance="reaction"]')
          .click({ timeout: 10000 });
      } else {
        await row.scrollIntoViewIfNeeded();
        const box = await row
          .locator('[data-slot="message-item"]')
          .first()
          .boundingBox();
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: box.x + box.width - 8, y: box.y + 8 }],
        });
        await page.waitForTimeout(650);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      }
      const picker = page.locator(
        '[data-message-affordance="reaction-picker"], [data-message-affordance="reaction-quick-row"]',
      );
      await picker.waitFor();
      let request;
      await page.route("**/v3/client/messages/react", async (route) => {
        request = route.request().postDataJSON();
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        await route.abort();
      });
      await picker.getByRole("button").first().click();
      await page
        .getByText(/结果未知/)
        .first()
        .waitFor();
      assert.ok(request?.active);
      const before = request;
      await page.unroute("**/v3/client/messages/react");
      const verify = page.getByRole("button", { name: /核实.*结果/ }).first();
      const replay = page.waitForRequest((r) =>
        r.url().endsWith("/messages/react"),
      );
      await verify.click();
      assert.deepEqual((await replay).postDataJSON(), before);
      await page
        .getByText(/结果未知/)
        .first()
        .waitFor({ state: "detached" });
      const social = (
        await client.request("message.social", {
          roomId: channels[0].roomId,
          messageIds: [id],
        })
      ).items[0];
      assert.equal(
        social.reactions.find((r) => r.emoji === before.emoji)?.count,
        1,
      );
      const removal = page.waitForResponse(
        (r) => r.url().endsWith("/messages/react") && r.status() === 200,
      );
      await row
        .getByRole("button", { name: new RegExp(before.emoji) })
        .first()
        .click();
      await removal;
      const removed = (
        await client.request("message.social", {
          roomId: channels[0].roomId,
          messageIds: [id],
        })
      ).items[0];
      assert.equal(removed.reactions.length, 0);
      assert.equal(
        await page.getByText("对外分享", { exact: true }).count(),
        0,
      );
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `/tmp/loom-reactions-${width}.png` });
      results.push({
        width,
        thread: !!thread,
        addRemove: true,
        lostResponseExactReplay: true,
        noDuplicate: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
