import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const engine = process.env.RAH_TEST_ENGINE === "firefox" ? firefox : chromium;
const browser = await engine.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  page.setDefaultTimeout(6000);
  const post = async (path, data) => {
    const r = await page.request.post(fixture.origin + "/v3/client/" + path, {
      data,
    });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  const workspace = (await post("workspaces/list", {})).workspaces[0];
  const control = (
    await post("rooms/sync", {
      roomId: workspace.controlRoomId,
      consumerId: "activity-identity",
      bootstrap: "latest",
    })
  ).latestRoomSeq;
  const room = (
    await post("rooms/create", {
      workspaceId: workspace.workspaceId,
      kind: "channel",
      visibility: "private",
      name: "Activity identity",
      slug: "activity-identity",
      basedOnControlRoomSeq: control,
      idempotencyKey: crypto.randomUUID(),
    })
  ).room;
  const roomId = room.roomId;
  const head = async () =>
    (
      await post("rooms/sync", {
        roomId,
        consumerId: "activity-identity",
        bootstrap: "latest",
      })
    ).latestRoomSeq;
  const body = "请@sun看这里；`@sun`；@unknown-person";
  const root = await post("messages/post", {
    roomId,
    body,
    recipients: [],
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });
  const thread = (
    await post("threads/create", {
      roomId,
      rootMessageId: root.event.aggregateId,
      recipientIds: [],
      basedOnRoomSeq: await head(),
      idempotencyKey: crypto.randomUUID(),
    })
  ).thread;
  await post("threads/reply", {
    roomId,
    threadId: thread.threadId,
    body,
    recipientIds: [],
    basedOnRoomSeq: await head(),
    idempotencyKey: crypto.randomUUID(),
  });

  await page.goto(fixture.origin + "/?surface=activity");
  const list = page.getByRole("main", {
    name: "全局动态",
    includeHidden: true,
  });
  const roomCard = page
    .locator(".feed-card")
    .filter({
      has: page.locator(".fc-title", { hasText: "Activity identity" }),
    })
    .locator(".rah-activity-open");
  let earlyContextReads = 0;
  const countEarlyContext = (request) => {
    if (request.url().endsWith("/messages/context")) earlyContextReads++;
  };
  page.on("request", countEarlyContext);
  await roomCard.click();
  await page.waitForTimeout(100);
  assert.equal(
    earlyContextReads,
    0,
    "first click must not open a preview before double-click arbitration",
  );
  await roomCard.click({ clickCount: 2 });
  await expect(async () =>
    assert.equal(
      new URL(page.url()).searchParams.get("surface") ?? "room",
      "room",
    ),
  ).toPass();
  page.off("request", countEarlyContext);
  await page.getByRole("button", { name: "动态", exact: true }).click();
  await expect(
    page.getByRole("separator", { name: "调整动态列表宽度" }),
  ).toHaveCount(0);
  await roomCard.click();
  await expect(page.locator(".rah-navigation-error")).toHaveCount(0);
  await expect(
    page.locator(".rah-product-shell > .channel:not(.rah-agent-peek)"),
  ).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("surface"), "activity");
  let repeatedResolutions = 0;
  const countResolution = (request) => {
    if (request.url().endsWith("/navigation/resolve")) repeatedResolutions++;
  };
  page.on("request", countResolution);
  await roomCard.click();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  assert.equal(
    repeatedResolutions,
    0,
    "selected activity click must not reload",
  );
  page.off("request", countResolution);
  const separator = page.getByRole("separator", { name: "调整动态列表宽度" });
  await expect(separator).toBeVisible();
  for (const width of [1800, 1440, 1000, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(async () => {
      const box = await list.boundingBox();
      if (width >= 768)
        assert.ok(
          box && box.width >= 320 && box.width <= 720,
          JSON.stringify(box),
        );
      else await expect(list).toBeHidden();
      await expect(
        page.locator(".rah-product-shell > .channel:not(.rah-agent-peek)"),
      ).toBeVisible();
    }).toPass({ timeout: 5000 });
  }
  await expect(separator).toHaveAttribute("aria-valuemin", "400");
  await separator.focus();
  await page.keyboard.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "400");
  await page.keyboard.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "720");
  const grip = await separator.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 120);
  await page.mouse.down();
  await page.mouse.move(grip.x - 120, grip.y + 120, { steps: 8 });
  await page.mouse.up();
  assert.ok(Number(await separator.getAttribute("aria-valuenow")) < 720);
  // Reuse the chat panel chain: feed + channel + thread; then feed + thread + profile.
  await page.setViewportSize({ width: 1800, height: 900 });
  await page
    .locator(".rah-product-shell > .channel .thread-preview")
    .first()
    .click();
  const threadPane = page.locator(".rah-product-shell > .thread");
  await expect(threadPane).toBeVisible();
  await expect(
    page.locator(".rah-product-shell > .channel:not(.rah-agent-peek)"),
  ).toBeVisible();
  await expect(separator).toHaveAttribute("aria-valuenow", "320");
  await threadPane
    .getByRole("button", { name: "查看 sun 资料", exact: true })
    .first()
    .click();
  const profile = page.locator(".rah-product-shell > .rah-agent-peek");
  await expect(profile).toBeVisible();
  await expect(threadPane).toBeVisible();
  await expect(
    page.locator(".rah-product-shell > .channel:not(.rah-agent-peek)"),
  ).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(profile).toBeVisible();
  await expect(threadPane).toBeHidden();
  assert.equal(new URL(page.url()).searchParams.get("surface"), "activity");
  await profile.getByRole("button", { name: "返回聊天", exact: true }).click();
  await expect(threadPane).toBeVisible();
  await threadPane
    .getByRole("button", { name: "返回聊天", exact: true })
    .click();
  await expect(
    page.locator(".rah-product-shell > .channel:not(.rah-agent-peek)"),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回动态列表", exact: true }).click();
  await expect(list).toBeVisible();
  await roomCard.click();
  await expect(list).toBeHidden();
  await expect(
    page.getByRole("button", { name: "关闭动态预览", exact: true }),
  ).toBeHidden();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(list).toBeVisible();
  const task = (
    await post("tasks/create", {
      roomId,
      basedOnRoomSeq: await head(),
      title: "Activity task panel",
      idempotencyKey: crypto.randomUUID(),
    })
  ).task;
  await page.getByRole("button", { name: "回到底部", exact: true }).click();
  await expect(
    page.locator(`.channel [data-message-id="${task.sourceMessageId}"]`),
  ).toBeVisible();
  await page
    .locator(`.channel [data-message-id="${task.sourceMessageId}"]`)
    .getByRole("button", { name: /任务/ })
    .first()
    .click();
  await expect(page.getByTestId("task-detail-metadata")).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("surface"), "activity");
  await expect(
    page.locator(".rah-product-shell > .channel:not(.rah-agent-peek)"),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭任务详情", exact: true }).click();
  await expect(page.getByTestId("task-detail-metadata")).toHaveCount(0);
  await page.reload();
  await expect(
    page.locator(".rah-product-shell > .channel:not(.rah-agent-peek)"),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭动态预览", exact: true }).click();
  await expect(list).toBeVisible();
  const threadCard = page
    .locator(".feed-card")
    .filter({ has: page.locator(".fc-title", { hasText: "请@" }) })
    .locator(".rah-activity-open");
  await threadCard.click();
  await expect(page.locator(".rah-product-shell > .thread")).toBeVisible();
  for (const width of [1800, 1000, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator(".rah-product-shell > .thread")).toBeVisible();
    assert.equal(new URL(page.url()).searchParams.get("surface"), "activity");
  }
  await page.goBack();
  await expect(list).toBeVisible();
  await expect(threadPane).toBeHidden();
  await page.goForward();
  await expect(threadPane).toBeVisible();
  assert.equal(new URL(page.url()).searchParams.get("surface"), "activity");
  await expect(async () => {
    const box = await threadPane.boundingBox();
    assert.ok(Math.abs(box.x + box.width - 1440) < 3);
    await expect(
      threadPane
        .getByRole("button", { name: "查看 sun 资料", exact: true })
        .first(),
    ).toBeVisible();
  }).toPass({ timeout: 5000 });
  await expect(threadPane).toHaveCSS("border-left-width", "0px");
  await threadCard.dblclick();
  await expect(async () =>
    assert.equal(
      new URL(page.url()).searchParams.get("surface") ?? "room",
      "room",
    ),
  ).toPass({ timeout: 5000 });
  await page.getByRole("button", { name: "动态", exact: true }).click();
  await expect(list).toBeVisible();
  await expect(
    page.getByRole("separator", { name: "调整动态列表宽度" }),
  ).toHaveCount(0);
  await expect(async () => {
    const box = await list.boundingBox();
    assert.ok(
      box.width > 1200,
      "returning after double click must not retain an empty preview column",
    );
  }).toPass();
  const touchPage = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  await touchPage.addInitScript(() => {
    window.activityClickWaits = 0;
    const original = window.setTimeout;
    window.setTimeout = function (callback, delay, ...args) {
      if (delay === 220) window.activityClickWaits++;
      return original(callback, delay, ...args);
    };
  });
  await touchPage.goto(fixture.origin + "/?surface=activity");
  await touchPage
    .locator(".feed-card")
    .filter({
      has: touchPage.locator(".fc-title", { hasText: "Activity identity" }),
    })
    .locator(".rah-activity-open")
    .tap();
  assert.equal(
    await touchPage.evaluate(() => window.activityClickWaits),
    0,
    "touch opening must not reserve the desktop double-click delay",
  );
  await expect(touchPage.locator(".channel .msg").first()).toBeVisible();
  await touchPage.close();
  await page.screenshot({ path: "/tmp/rah-activity-panels.png" });
  console.log(
    "PASS activity root/thread preview, resize, separator, reload and close",
  );
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close();
  await fixture.close();
}
