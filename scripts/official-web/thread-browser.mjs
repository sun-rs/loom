import assert from "node:assert/strict";
export async function verifyThreads({
  browser,
  origin,
  client,
  workspace,
  otherChannel,
  head,
}) {
  const channel = (
    await client.request("room.create", {
      workspaceId: workspace.workspaceId,
      basedOnControlRoomSeq: await head(workspace.controlRoomId),
      idempotencyKey: "thread-fixture-room",
      kind: "channel",
      name: "FIXTURE threads",
      slug: "fixture-threads",
    })
  ).room;
  const results = [];
  for (const width of [1440, 390]) {
    await client.request("message.post", {
      roomId: channel.roomId,
      body: `FIXTURE thread root ${width}`,
      recipients: [],
      basedOnRoomSeq: await head(channel.roomId),
      idempotencyKey: `thread-root-${width}`,
    });
    const root = (
      await client.request("message.list", {
        roomId: channel.roomId,
        limit: 50,
      })
    ).messages.find((m) => m.body === `FIXTURE thread root ${width}`);
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 1000 },
      deviceScaleFactor: 1,
      hasTouch: width === 390,
      isMobile: width === 390,
      serviceWorkers: "block",
    });
    try {
      const page = await context.newPage();
      const errors = [];
      const external = [];
      const creates = [];
      const sends = [];
      const readMarks = [];
      page.on("request", (request) => {
        if (request.url().endsWith("/v3/client/activity/mark")) {
          const body = request.postDataJSON();
          if (body.threadId) readMarks.push(body);
        }
      });
      let replyAborted;
      const replyFailure = new Promise((resolve) => {
        replyAborted = resolve;
      });
      page.on("pageerror", (e) => errors.push(e.message));
      await page.route("**/*", (route) => {
        if (new URL(route.request().url()).origin !== origin) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await page.route("**/v3/client/threads/create", async (route) => {
        creates.push(route.request().postDataJSON());
        if (creates.length === 1) {
          await route.fetch();
          await route.abort();
        } else await route.continue();
      });
      await page.route("**/v3/client/threads/reply", async (route) => {
        sends.push(route.request().postDataJSON());
        if (sends.length === 1) {
          await route.fetch();
          await route.abort();
          replyAborted();
        } else await route.continue();
      });
      await page.goto(`${origin}/?room=${channel.roomId}`);
      const message = page.locator(
        `[data-timeline-message-id="${root.messageId}"]`,
      );
      await message.waitFor();
      if (width === 390)
        await message.getByText(root.body, { exact: true }).tap();
      else {
        await message.hover();
        await message.locator('[data-message-affordance="thread"]').click();
      }
      const panel = page.getByTestId("thread-side-column");
      await panel.getByTestId("thread-panel-parent").waitFor();
      assert.equal(
        new URL(page.url()).searchParams.get("thread"),
        root.messageId,
      );
      assert.equal(creates.length, 0, "opening is read-only");
      assert.equal(sends.length, 0);
      if (width === 1440) {
        const before = await panel.boundingBox();
        assert.equal(Math.round(before.width), 400);
        const handle = await page
          .getByTestId("loom-thread-resizer")
          .boundingBox();
        await page.mouse.move(handle.x + 4, handle.y + 100);
        await page.mouse.down();
        await page.mouse.move(handle.x - 76, handle.y + 100, { steps: 5 });
        await page.mouse.up();
        assert.ok((await panel.boundingBox()).width > before.width + 50);
      } else assert.ok(Math.abs((await panel.boundingBox()).width - width) < 2);
      const input = panel.getByTestId("composer-textarea");
      await input.fill(`FIXTURE reply ${width}`);
      await input.dispatchEvent("keydown", {
        key: "Enter",
        code: "Enter",
        isComposing: true,
        keyCode: 229,
      });
      assert.equal(creates.length, 0, "IME confirmation does not send");
      await input.press("Shift+Enter");
      assert.ok((await input.inputValue()).endsWith("\n"));
      await input.fill(`FIXTURE reply ${width}`);
      if (width === 390) await panel.locator('button[type="submit"]').click();
      else await input.press("Enter");
      const verify = panel.getByRole("button", { name: "核实回复结果" });
      await verify.waitFor();
      assert.equal(creates.length, 1);
      assert.equal(sends.length, 0);
      await page.keyboard.press("Escape");
      assert.equal(
        await panel.count(),
        1,
        "unknown creation keeps intent owner mounted",
      );
      await verify.click();
      let timeout;
      try {
        await Promise.race([
          replyFailure,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  Error("Reply verification did not reach the reply request"),
                ),
              30000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      await verify.waitFor();
      assert.equal(sends.length, 1);
      const originalUrl = page.url();
      await page.evaluate((room) => {
        history.pushState({}, "", `?room=${room}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, otherChannel.roomId);
      await page.waitForURL(originalUrl);
      await page.route("**/v3/client/messages/context", (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "forbidden",
              message: "FIXTURE unknown read denied",
            },
          }),
        }),
      );
      await panel
        .getByText("消息列暂时无法读取，请重试。", { exact: true })
        .waitFor();
      await verify.click();
      await page.unroute("**/v3/client/messages/context");
      await panel
        .getByText(`FIXTURE reply ${width}`, { exact: true })
        .waitFor();
      assert.deepEqual(creates[0], creates[1]);
      assert.deepEqual(sends[0], sends[1]);
      assert.equal(await input.inputValue(), "");
      const thread = (
        await client.request("thread.list", { roomId: channel.roomId })
      ).threads.find((t) => t.rootMessageId === root.messageId);
      assert.ok(thread);
      assert.equal(thread.replyCount, 1);
      // Native menu uses authenticated Human following state. A lost write is
      // resolved by reading, not repeating the preference mutation.
      const initial = await client.request("thread.followers", {
        roomId: channel.roomId,
        threadId: thread.threadId,
      });
      const follows = [];
      await page.route("**/v3/client/activity/follow", async (route) => {
        follows.push(route.request().postDataJSON());
        await route.fetch();
        await route.abort();
      });
      await panel.getByTestId("thread-overflow-trigger").click();
      const verifiedFollow = page.waitForResponse(
        (response) =>
          response.url().endsWith("/v3/client/activity/thread-followers") &&
          response.ok(),
      );
      await page.getByTestId("thread-overflow-follow-action").click();
      await verifiedFollow;
      assert.equal(follows.length, 1, "lost follow is not resent");
      const after = await client.request("thread.followers", {
        roomId: channel.roomId,
        threadId: thread.threadId,
      });
      assert.equal(after.following, !initial.following);
      await panel.getByTestId("thread-overflow-trigger").click();
      await page.getByTestId("thread-overflow-menu").waitFor();
      assert.match(
        await page.getByTestId("thread-overflow-follow-action").textContent(),
        after.following ? /^Unfollow Thread$/ : /^Follow Thread$/,
      );
      await page.keyboard.press("Escape");
      await page
        .getByTestId("thread-overflow-menu")
        .waitFor({ state: "detached" });
      await page.unroute("**/v3/client/activity/follow");
      const replies = await client.request("message.list", {
        roomId: channel.roomId,
        threadId: thread.threadId,
        limit: 50,
      });
      for (let i = 0; !readMarks.length && i < 20; i++)
        await page.waitForTimeout(100);
      assert.ok(
        readMarks.length,
        "visible thread replies advance their own read scope",
      );
      assert.ok(
        readMarks.every(
          (mark) =>
            mark.roomId === channel.roomId &&
            mark.threadId === thread.threadId &&
            mark.action === "read" &&
            mark.source === "viewport" &&
            replies.messages.some((m) => m.roomSeq === mark.throughSeq),
        ),
      );

      await page.reload();
      await panel
        .getByText(`FIXTURE reply ${width}`, { exact: true })
        .waitFor();
      await page.screenshot({ path: `/tmp/loom-thread-${width}.png` });
      await panel
        .getByTestId(width === 390 ? "thread-mobile-back" : "thread-close")
        .click();
      await panel.waitFor({ state: "detached" });
      await message.getByTestId("message-thread-replies-badge").click();
      await panel
        .getByText(`FIXTURE reply ${width}`, { exact: true })
        .waitFor();
      // Revoked/failed reads clear content and disable new sends, preserving the input.
      await input.fill("FIXTURE retained draft");
      await page.route("**/v3/client/messages/context", (route) =>
        route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "forbidden", message: "FIXTURE denied" },
          }),
        }),
      );
      await panel
        .getByText("消息列暂时无法读取，请重试。", { exact: true })
        .waitFor();
      assert.equal(
        await panel
          .getByText(`FIXTURE reply ${width}`, { exact: true })
          .count(),
        0,
      );
      assert.equal(await input.inputValue(), "FIXTURE retained draft");
      await input.press("Enter");
      assert.equal(sends.length, 2);
      assert.equal(
        await panel.getByTestId("thread-panel-parent").count(),
        0,
        "denied reads hide the stale parent as well as replies",
      );
      await page.unroute("**/v3/client/messages/context");
      await panel
        .getByText(`FIXTURE reply ${width}`, { exact: true })
        .waitFor();
      assert.equal(await input.inputValue(), "FIXTURE retained draft");
      if (width === 1440) {
        for (let i = 1; i <= 55; i++)
          await client.request("thread.reply", {
            roomId: channel.roomId,
            threadId: thread.threadId,
            body: `FIXTURE thread history ${i}`,
            recipientIds: [],
            basedOnRoomSeq: await head(channel.roomId),
            idempotencyKey: `thread-history-${i}`,
          });
        const pages = [];
        page.on("request", (r) => {
          if (r.url().endsWith("/messages/list")) pages.push(r.postDataJSON());
        });
        await page.reload();
        await panel
          .getByText("FIXTURE thread history 55", { exact: true })
          .waitFor();
        const scroller = panel.getByTestId("thread-message-scroller");
        await scroller.evaluate((el) => {
          el.scrollTop = 0;
        });
        await panel
          .getByText(`FIXTURE reply ${width}`, { exact: true })
          .waitFor();
        assert.ok(
          pages.some(
            (p) => p.threadId === thread.threadId && p.beforeSeq !== undefined,
          ),
        );
        assert.ok(pages.every((p) => p.limit <= 50));
      }
      await page.goto(
        `${origin}/?room=${otherChannel.roomId}&thread=${root.messageId}`,
      );
      await panel
        .getByText("消息列暂时无法读取，请重试。", { exact: true })
        .waitFor();
      assert.equal(
        await panel.getByText(root.body, { exact: true }).count(),
        0,
      );
      assert.equal(sends.length, 2);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      results.push({
        width,
        readOnlyOpen: true,
        followLostResponseReadback: true,
        scopedVisibleRead: true,
        nativeMenuEscape: true,
        createAndReplyExactReplay: true,
        oneReply: true,
        reload: true,
        nativeResizeOrMobileReturn: true,
        readFailureClearsContentAndRetainsDraft: true,
        foreignRootRejected: true,
      });
    } finally {
      await context.close();
    }
  }
  return results;
}
