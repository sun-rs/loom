// Isolated Core, real durable activity/preferences, fake runtime only.
import assert from "node:assert/strict";
export async function verifyRemaining138({
  browser,
  origin,
  client,
  channels,
  workspace,
  head,
}) {
  const room = channels[0];
  await client.request("message.post", {
    roomId: room.roomId,
    body: "FIXTURE cover root",
    recipients: [],
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "rest138-root",
  });
  const root = (
    await client.request("message.list", { roomId: room.roomId, limit: 100 })
  ).messages.find((m) => m.body === "FIXTURE cover root");
  const thread = (
    await client.request("thread.create", {
      roomId: room.roomId,
      rootMessageId: root.messageId,
      basedOnRoomSeq: await head(room.roomId),
      idempotencyKey: "rest138-thread",
    })
  ).thread;
  await client.request("thread.reply", {
    roomId: room.roomId,
    threadId: thread.threadId,
    body: "FIXTURE own reply",
    recipientIds: [],
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "rest138-reply",
  });
  await client.request("task.create", {
    roomId: room.roomId,
    title: "FIXTURE cover task",
    basedOnRoomSeq: await head(room.roomId),
    idempotencyKey: "rest138-task",
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    }),
    page = await context.newPage(),
    errors = [],
    followWrites = [];
  await context.addInitScript(() => {
    window.__fixtureClipboard = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text) => window.__fixtureClipboard.push(text),
      },
    });
  });
  page.setDefaultTimeout(7000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().endsWith("/v3/client/activity/follow"))
      followWrites.push(r.postDataJSON());
  });
  try {
    await page.goto(`${origin}/?room=${room.roomId}&thread=${root.messageId}`);
    const threadPanel = page.getByTestId("read-only-thread-panel");
    await threadPanel.waitFor();
    const draft = threadPanel.getByTestId("composer-textarea");
    await draft.fill("FIXTURE retained cover draft");
    await page.getByTestId("panel-tab-tasks").click();
    await page.getByTestId("loom-tasks-page").waitFor();
    await page
      .getByTestId("loom-tasks-page")
      .evaluate((el) => (el.__fixtureIdentity = "same-mounted-tasks"));
    for (const width of [840, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByTestId("thread-cover-tabs").waitFor();
      await page.getByTestId("thread-cover-tab-tasks").click();
      assert.ok(await page.getByTestId("loom-tasks-page").isVisible());
      assert.equal(
        await page
          .getByTestId("loom-tasks-page")
          .evaluate((el) => el.__fixtureIdentity),
        "same-mounted-tasks",
      );
      assert.equal(await threadPanel.evaluate((el) => el.inert), true);
      await page.screenshot({
        path: `/tmp/loom-closeout-cover-${width}.png`,
        animations: "disabled",
      });
      await page.getByTestId("thread-cover-tab-thread").click();
      assert.equal(await draft.inputValue(), "FIXTURE retained cover draft");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId("thread-cover-tabs").waitFor({ state: "hidden" });
    assert.equal(await draft.inputValue(), "FIXTURE retained cover draft");
    const reply = threadPanel.getByText("FIXTURE own reply", { exact: true });
    await reply.waitFor();
    const replyId = await reply.evaluate((el) =>
      el
        .closest("[data-timeline-message-id]")
        .getAttribute("data-timeline-message-id"),
    );
    const messageMenu = page
      .getByRole("menu")
      .filter({ hasText: "复制 Markdown" });
    await reply.click({ button: "right" });
    await messageMenu
      .getByRole("menuitem", { name: "复制 Markdown", exact: true })
      .click();
    await page.waitForFunction(
      () => window.__fixtureClipboard.at(-1) === "FIXTURE own reply",
    );
    await reply.click({ button: "right" });
    await messageMenu
      .getByRole("menuitem", { name: "复制链接", exact: true })
      .click();
    await page.waitForFunction(() =>
      window.__fixtureClipboard.at(-1)?.startsWith("http"),
    );
    const copiedLink = new URL(
      await page.evaluate(() => window.__fixtureClipboard.at(-1)),
    );
    assert.equal(copiedLink.searchParams.get("thread"), root.messageId);
    assert.equal(copiedLink.searchParams.get("message"), replyId);
    await client.request("message.save", {
      roomId: room.roomId,
      messageId: replyId,
      saved: true,
      idempotencyKey: "rest138-save-reply",
    });
    await page.goto(origin + "/?view=activity");
    const list = (
      await client.request("activity.list", {
        workspaceId: workspace.workspaceId,
        limit: 100,
      })
    ).items;
    const item = list.find(
      (i) => i.roomId === room.roomId && i.kind === "channel",
    );
    assert.ok(item);
    const row = page.locator(`[data-result-id="${item.key}"]`);
    await row.waitFor();
    await row.click({ button: "right" });
    const menu = page.getByTestId("activity-context-menu");
    await menu.waitFor();
    await menu.getByRole("menuitem", { name: "标为未读", exact: true }).click();
    await row.getByTestId("conversation-card-marked-unread").waitFor();
    let durable = (
      await client.request("activity.list", {
        workspaceId: workspace.workspaceId,
        filter: "unread",
        limit: 100,
      })
    ).items.find((i) => i.key === item.key);
    assert.equal(durable?.markedUnread, true);
    assert.equal(durable?.unreadCount, 0);
    await page.reload();
    await row.getByTestId("conversation-card-marked-unread").waitFor();
    await row.click({ button: "right" });
    await menu.getByRole("menuitem", { name: "标为已读", exact: true }).click();
    await row
      .getByTestId("conversation-card-marked-unread")
      .waitFor({ state: "hidden" });
    await row.click({ button: "right" });
    await menu
      .getByRole("menuitem", { name: "静音活动", exact: true })
      .waitFor();
    assert.equal(
      await menu.locator('[data-slot="menu-item"] > svg').count(),
      3,
      "icons use the native leading icon slot",
    );
    await page.keyboard.press("End");
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent),
      "静音活动",
    );
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    const threadRow = page.locator(
      `[data-result-id="thread:${thread.threadId}"]`,
    );
    await threadRow.waitFor();
    await threadRow.click({ button: "right" });
    const contextCommit = page.waitForResponse(
      (r) =>
        r.url().endsWith("/v3/client/activity/follow") && r.status() === 200,
    );
    await menu.getByRole("menuitem", { name: "取消关注", exact: true }).click();
    await contextCommit;
    assert.equal(
      followWrites.length,
      1,
      "native context-menu unfollow commits immediately",
    );
    await client.request("activity.follow", {
      roomId: room.roomId,
      threadId: thread.threadId,
      following: true,
    });
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      locale: "zh-CN",
    });
    try {
      await mobile.addInitScript(() => {
        window.__fixtureClipboard = [];
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => window.__fixtureClipboard.push(text),
          },
        });
      });
      const phone = await mobile.newPage(),
        swipeWrites = [];
      phone.on("request", (r) => {
        if (r.url().endsWith("/v3/client/activity/follow"))
          swipeWrites.push(r.postDataJSON());
      });
      await phone.goto(origin + "/?view=activity");
      const card = phone.locator(
        `[data-result-id="thread:${thread.threadId}"]`,
      );
      await card.waitFor();
      const cdp = await mobile.newCDPSession(phone);
      const swipe = async () => {
        await card.scrollIntoViewIfNeeded();
        const box = await card.boundingBox(),
          y = box.y + box.height / 2;
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: 340, y }],
        });
        for (const x of [310, 270, 230, 190])
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x, y }],
          });
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await card.getByTestId("inbox-row-swipe-unfollow").tap();
      };
      await swipe();
      assert.equal(swipeWrites.length, 0);
      await phone.getByRole("button", { name: "撤销", exact: true }).tap();
      assert.equal(
        swipeWrites.length,
        0,
        "swipe undo never sends an unfollow/refollow pair",
      );
      await card.waitFor();
      await swipe();
      await phone.waitForResponse(
        (r) =>
          r.url().endsWith("/v3/client/activity/follow") && r.status() === 200,
        { timeout: 10000 },
      );
      assert.equal(swipeWrites.length, 1);
      assert.equal(swipeWrites[0].following, false);
      await phone.goto(
        `${origin}/?room=${room.roomId}&thread=${root.messageId}`,
      );
      const panel = phone.getByTestId("read-only-thread-panel");
      await panel.waitFor();
      const body = panel.getByText("FIXTURE own reply", { exact: true });
      await body.scrollIntoViewIfNeeded();
      const rect = await body.boundingBox(),
        point = { x: rect.x + 20, y: rect.y + Math.min(10, rect.height / 2) };
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point],
      });
      await phone
        .getByRole("menuitem", { name: "选择文本", exact: true })
        .waitFor();
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await phone
        .getByRole("menuitem", { name: "选择文本", exact: true })
        .tap();
      const selection = phone.locator("[data-message-select-text-body]");
      await selection.waitFor();
      await selection.evaluate((el) => {
        el.focus();
        const at = el.value.indexOf("own");
        el.setSelectionRange(at, at + 3);
      });
      await phone
        .locator("[data-message-select-text]")
        .getByRole("button", { name: "引用", exact: true })
        .tap();
      await phone.waitForFunction(() =>
        document
          .querySelector(
            '[data-testid="read-only-thread-panel"] [data-testid="composer-textarea"]',
          )
          ?.value.includes("> own"),
      );
      assert.equal(
        await phone
          .locator('.thread-main-column [data-testid="composer-textarea"]')
          .inputValue(),
        "",
        "thread quote must not enter the hidden channel composer",
      );
      await phone.goto(origin + "/?saved=1");
      const saved = phone
        .getByTestId("saved-list-scroller")
        .locator("[data-saved-row]")
        .first();
      await saved.waitFor();
      await saved.click({ button: "right" });
      await phone
        .getByRole("menuitem", { name: "复制 Markdown", exact: true })
        .click();
      await phone.waitForFunction(
        () => window.__fixtureClipboard.at(-1) === "FIXTURE own reply",
      );
      await saved.click({ button: "right" });
      await phone
        .getByRole("menuitem", { name: "复制链接", exact: true })
        .click();
      await phone.waitForFunction(() =>
        window.__fixtureClipboard.at(-1)?.startsWith("http"),
      );
      assert.equal(
        new URL(
          await phone.evaluate(() => window.__fixtureClipboard.at(-1)),
        ).searchParams.get("thread"),
        root.messageId,
      );
    } finally {
      await mobile.close();
    }
    assert.deepEqual(errors, []);
    return {
      coverTabs: true,
      mountedTasksAndDraft: true,
      durableManualUnread: true,
      noFabricatedCount: true,
      nativeMenuIconsAndKeyboard: true,
      contextUnfollowImmediate: true,
      deferredSwipeUnfollow: true,
      messageAndSavedCopy: true,
      threadQuoteScope: true,
      errors,
    };
  } finally {
    await context.close();
  }
}
