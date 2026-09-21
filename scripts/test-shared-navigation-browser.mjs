import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture();
const engine = process.env.RAH_BROWSER === "firefox" ? firefox : chromium;
const browser = await engine.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  page.setDefaultTimeout(12000);
  const post = async (path, data) => {
    let r = await page.request.post(f.origin + "/v3/client/" + path, { data });
    for (let i = 0; r.status() === 409 && i < 10; i++) {
      data.basedOnRoomSeq = await head();
      r = await page.request.post(f.origin + "/v3/client/" + path, { data });
    }
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const head = async () =>
    (
      await post("rooms/sync", {
        roomId: f.roomId,
        consumerId: "shared-navigation",
        bootstrap: "latest",
      })
    ).latestRoomSeq;
  const root = (
    await post("messages/post", {
      roomId: f.roomId,
      body: "Isolated shared navigation fixture",
      recipients: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    })
  ).event.aggregateId;
  const t = (
    await post("threads/create", {
      roomId: f.roomId,
      rootMessageId: root,
      recipientIds: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    })
  ).thread;
  await post("threads/reply", {
    roomId: f.roomId,
    threadId: t.threadId,
    body: "Fixture reply",
    recipientIds: [],
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });
  const channel = page.locator(
    ".rah-product-shell > .channel:not(.rah-agent-peek)",
  );
  const thread = page.getByTestId("thread-side-column");
  const profile = page.locator(".rah-agent-peek");
  for (const surface of ["room", "search", "activity"]) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(
      f.origin +
        "/?" +
        new URLSearchParams(
          surface === "room"
            ? { room: f.roomId }
            : { surface, previewRoom: f.roomId },
        ),
    );
    await expect(channel).toBeVisible();
    await expect(channel.locator(".rah-search-preview-close")).toHaveCount(0);
    if (surface !== "room") {
      const seam = await page.evaluate(() => {
        const list = document.querySelector(".rah-discovery");
        const room = document.querySelector(".channel");
        const drag = document.querySelector(".rah-search-resizer");
        return {
          total:
            parseFloat(getComputedStyle(list).borderRightWidth) +
            parseFloat(getComputedStyle(room).borderLeftWidth),
          hit: drag.getBoundingClientRect().width,
          line: getComputedStyle(drag, "::after").width,
        };
      });
      assert.deepEqual(seam, { total: 2, hit: 8, line: "2px" });
    }

    const composer = channel.getByRole("textbox", {
      name: "消息输入框",
      exact: true,
    });
    await composer.fill("Retained parent draft");
    await channel
      .locator(".thread-preview")
      .filter({ hasText: "条回复" })
      .first()
      .click();
    await expect(thread).toBeVisible();
    await expect(channel).toBeVisible();
    await thread
      .getByRole("textbox", { name: "Thread 回复输入框", exact: true })
      .fill("Retained child draft");
    await thread
      .locator('.rah-message-avatar-trigger[aria-label$="资料"]')
      .first()
      .click();
    await expect(profile).toBeVisible();
    await expect(channel).toBeHidden();
    await expect(thread).toBeVisible();
    for (const height of [600, 1400]) {
      await page.setViewportSize({ width: 900, height });
      await expect(profile).toBeVisible();
      await expect(thread).toBeHidden();
      await expect(profile.locator(".rah-agent-mobile-back")).toBeHidden();
      await expect(
        profile.getByRole("button", { name: /关闭.*侧栏/ }),
      ).toBeVisible();
    }
    await profile.getByRole("button", { name: /关闭.*侧栏/ }).click();
    await expect(thread).toBeVisible();
    await expect(thread.locator(".rah-thread-close")).toBeVisible();
    await expect(thread.locator(".rah-thread-back")).toBeHidden();
    await thread.locator(".rah-thread-close").click();
    await expect(channel).toBeVisible();
    await expect(composer).toHaveValue("Retained parent draft");
    await channel.locator(".thread-preview").first().click();
    await thread
      .getByRole("textbox", { name: "Thread 回复输入框", exact: true })
      .fill("Retained child draft");
    await thread
      .locator('.rah-message-avatar-trigger[aria-label$="资料"]')
      .first()
      .click();
    await page.screenshot({
      path: `/tmp/shared-navigation-${surface}-middle.png`,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(profile.locator(".rah-agent-mobile-back")).toBeVisible();
    await expect(
      profile.getByRole("button", { name: /关闭.*侧栏/ }),
    ).toBeHidden();
    await profile.locator(".rah-agent-mobile-back").click();
    await expect(thread).toBeVisible();
    await expect(
      thread.getByRole("textbox", { name: "Thread 回复输入框", exact: true }),
    ).toHaveValue("Retained child draft");
    await thread.locator(".rah-thread-back").click();
    await expect(channel).toBeVisible();
    await expect(composer).toHaveValue("Retained parent draft");
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(thread).toBeHidden();
    await expect(profile).toBeHidden();
    await page.screenshot({ path: `/tmp/shared-navigation-${surface}.png` });
    if (surface === "room") {
      await page.setViewportSize({ width: 390, height: 844 });
      await channel.locator(".rah-mobile-back").click();
    } else {
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", {
          name: surface === "search" ? "搜索" : "动态",
          exact: true,
        })
        .click();
    }
    await expect(channel.locator(".rah-conversation-head")).toHaveCount(0);
    console.log(surface + " nested four-layer path passed");
  }
  for (const surface of ["search", "activity"]) {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(
      f.origin +
        "/?" +
        new URLSearchParams({
          surface,
          room: f.roomId,
          thread: `${f.roomId}:${root}`,
          previewRoom: f.roomId,
          previewThread: t.threadId,
          previewRoot: root,
          previewMessage: root,
        }),
    );
    await expect(thread).toBeVisible();
    await expect(channel).toBeHidden();
    await page.reload();
    await expect(thread).toBeVisible();
    await thread
      .locator('.rah-message-avatar-trigger[aria-label$="资料"]')
      .first()
      .click();
    await expect(profile).toBeVisible();
    await page.setViewportSize({ width: 900, height: 1000 });
    await profile.getByRole("button", { name: /关闭.*侧栏/ }).click();
    await expect(thread).toBeVisible();
    await thread.locator(".rah-thread-close").click();
    await expect(thread).toBeHidden();
    await expect(channel).toBeHidden();
    await expect(page.locator(".rah-discovery")).toBeVisible();
  }
  console.log("Shared navigation passed");
} finally {
  await browser.close();
  await f.close();
}
