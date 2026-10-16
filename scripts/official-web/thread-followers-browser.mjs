import assert from "node:assert/strict";
export async function verifyThreadFollowers({
  browser,
  origin,
  client,
  channel,
  instances,
  head,
}) {
  const results = [];
  for (const width of [1440, 390]) {
    const root = await client.request("message.post", {
      roomId: channel.roomId,
      body: `FIXTURE followers ${width}`,
      recipients: [],
      basedOnRoomSeq: await head(channel.roomId),
      idempotencyKey: `followers-root-${width}`,
    });
    const messages = await client.request("message.list", {
      roomId: channel.roomId,
      limit: 50,
    });
    const message = messages.messages.find(
      (m) => m.body === `FIXTURE followers ${width}`,
    );
    const { thread } = await client.request("thread.create", {
      roomId: channel.roomId,
      rootMessageId: message.messageId,
      recipientIds: instances.map((i) => i.instanceId),
      basedOnRoomSeq: await head(channel.roomId),
      idempotencyKey: `followers-thread-${width}`,
    });
    const scope = { roomId: channel.roomId, threadId: thread.threadId };
    assert.equal(
      (await client.request("thread.followers", scope)).agentParticipantIds
        .length,
      2,
    );
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      hasTouch: width === 390,
      isMobile: width === 390,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(
        `${origin}/?room=${channel.roomId}&thread=${message.messageId}`,
      );
      const trigger = page.getByTestId("thread-followers-header-trigger");
      await trigger.click();
      const popover = page.getByTestId("thread-followers-popover");
      assert.equal(await popover.getByTestId("thread-follower-row").count(), 2);
      const removed = page.waitForResponse((r) =>
        r.url().endsWith("/thread-followers/remove"),
      );
      await popover.getByTestId("thread-follower-remove").first().click();
      await removed;
      const undo = page.getByRole("button", { name: "Undo", exact: true });
      await undo.waitFor();
      assert.equal(
        (await client.request("thread.followers", scope)).agentParticipantIds
          .length,
        1,
      );
      const restored = page.waitForResponse((r) =>
        r.url().endsWith("/thread-followers/restore"),
      );
      await undo.click();
      await restored;
      assert.equal(
        (await client.request("thread.followers", scope)).agentParticipantIds
          .length,
        2,
      );
      await page.keyboard.press("Escape");
      await popover.waitFor({ state: "detached" });
      await trigger.click();
      let mutations = 0;
      await page.route(
        "**/v3/client/activity/thread-followers/remove",
        async (route) => {
          mutations++;
          await route.fetch();
          await route.abort();
        },
      );
      const reread = page.waitForResponse(
        (r) => r.url().endsWith("/activity/thread-followers") && r.ok(),
      );
      await popover.getByTestId("thread-follower-remove").first().click();
      await reread;
      assert.equal(mutations, 1);
      assert.equal(
        (await client.request("thread.followers", scope)).agentParticipantIds
          .length,
        1,
      );
      await page.screenshot({ path: `/tmp/loom-followers-${width}.png` });
      assert.deepEqual(errors, []);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      results.push({
        width,
        nativeRoster: true,
        removeAndUndo: true,
        lostRemoveReadbackWithoutRetry: true,
        noFakePresence: true,
        pageErrors: errors,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
