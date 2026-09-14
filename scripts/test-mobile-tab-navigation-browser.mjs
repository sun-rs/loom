import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const evidence = mkdtempSync(`${tmpdir()}/rah-mobile-tabs-`);
const browser = await (
  process.env.RAH_MOBILE_ENGINE === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(fixture.origin);
  const nav = page.getByRole("navigation", { name: "移动端主导航" });
  await expect(nav).toBeVisible();
  await expect(
    page.locator(".rah-navigation-toggle,.rah-navigation-drawer"),
  ).toHaveCount(0);
  for (const name of ["首页", "任务", "成员", "设置"])
    await expect(nav.getByRole("button", { name, exact: true })).toBeVisible();
  const home = page.locator(".rah-room-sidebar.is-open");
  await expect(home).toBeVisible();
  for (const name of ["搜索", "动态"])
    await expect(home.getByRole("button", { name, exact: true })).toBeVisible();
  await home.getByRole("button", { name: "通知", exact: true }).tap();
  const inbox = page.getByRole("dialog", { name: "Human Inbox" });
  await expect(inbox).toBeVisible();
  const bell = await home
    .getByRole("button", { name: "通知", exact: true })
    .boundingBox();
  const popup = await inbox.boundingBox();
  assert.ok(
    popup.y >= bell.y + bell.height &&
      popup.x >= 0 &&
      popup.x + popup.width <= 390,
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${evidence}/notifications.png` });
  await page.keyboard.press("Escape");
  await home.getByRole("button", { name: "搜索", exact: true }).tap();
  const input = page.getByRole("textbox", { name: "搜索频道、私信、消息" });
  await expect(input).toBeVisible();
  assert.ok(
    (await input.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >=
      16,
  );
  assert.equal(await page.evaluate(() => visualViewport?.scale ?? 1), 1);
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "返回聊天", exact: true }).tap();
  await nav.getByRole("button", { name: "任务", exact: true }).tap();
  const tasks = page.getByRole("main", { name: "全局任务" });
  await expect(tasks.locator(".channel-sub")).toBeVisible();
  const views = tasks.getByRole("radiogroup", { name: "任务视图" });
  assert.ok(
    await views.evaluate((e) => !!e.closest("header")),
    "mobile task view selector belongs to title header",
  );
  for (const name of ["频道", "创建者", "负责人"]) {
    await tasks.getByRole("button", { name, exact: true }).tap();
    const filter = page.getByRole("textbox", {
      name: `搜索${name}`,
      exact: true,
    });
    await expect(filter).toBeVisible();
    assert.ok(
      (await filter.evaluate((e) =>
        parseFloat(getComputedStyle(e).fontSize),
      )) >= 16,
    );
    assert.equal(await page.evaluate(() => visualViewport?.scale ?? 1), 1);
    await page.keyboard.press("Escape");
  }
  await tasks.getByRole("button", { name: "频道", exact: true }).tap();
  await page.getByRole("menuitemcheckbox").first().tap();
  await page.keyboard.press("Escape");
  const clear = tasks.getByRole("button", { name: "清除筛选", exact: true });
  await expect(clear).toBeVisible();
  const filterRow = await tasks.locator(".tasks-toolbar-row").boundingBox(),
    cb = await clear.boundingBox();
  assert.ok(
    cb.x + cb.width <= 390 &&
      cb.y >= filterRow.y &&
      cb.y + cb.height <= filterRow.y + filterRow.height,
    "clear filter fits its mobile row",
  );
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${evidence}/tasks.png` });
  await clear.tap();
  for (const [label, shot] of [
    ["成员", "members"],
    ["设置", "settings"],
  ]) {
    await nav.getByRole("button", { name: label, exact: true }).tap();
    await expect(nav).toBeVisible();
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${evidence}/${shot}.png` });
  }
  await page
    .locator(".rah-settings-mobile-index")
    .getByRole("button", { name: "账户", exact: true })
    .tap();
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "返回设置", exact: true }).tap();
  await expect(nav).toBeVisible();
  await page
    .locator(".rah-settings-mobile-index")
    .getByRole("button", { name: "计算机", exact: true })
    .tap();
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "返回计算机列表", exact: true }).tap();
  await page.getByRole("button", { name: "返回设置", exact: true }).tap();
  await expect(nav).toBeVisible();
  await nav.getByRole("button", { name: "成员", exact: true }).tap();
  await page.locator(".rah-agent-member-row").first().tap();
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "返回成员列表", exact: true }).tap();
  await expect(nav).toBeVisible();
  await nav.getByRole("button", { name: "首页", exact: true }).tap();
  await home
    .locator(`[data-sidebar-key="room:${fixture.roomId}"] button`)
    .first()
    .tap();
  await expect(nav).toBeHidden();
  await expect(
    page.getByRole("textbox", { name: "消息输入框", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${evidence}/room.png` });
  await page.getByRole("button", { name: "返回主页", exact: true }).tap();
  await expect(nav).toBeVisible();
  await home
    .locator('[data-sidebar-group="dms"] [data-sidebar-key] button')
    .first()
    .tap();
  await expect(nav).toBeHidden();
  await page.getByRole("button", { name: "返回主页", exact: true }).tap();
  await expect(nav).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${evidence}/home.png` });
  await page.goto(
    `${fixture.origin}/?surface=settings&inputRequest=fixture-notification-link`,
  );
  await expect(inbox).toBeVisible();
  await expect(home).toBeVisible();
  const linkedPopup = await inbox.boundingBox();
  assert.ok(linkedPopup.x >= 0 && linkedPopup.x + linkedPopup.width <= 390);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(nav).toBeHidden();
  await expect(page.locator(".rah-product-shell > .rail")).toBeVisible();
  console.log("PASS mobile native-style tabs", evidence);
} finally {
  await browser.close();
  await fixture.close();
}
