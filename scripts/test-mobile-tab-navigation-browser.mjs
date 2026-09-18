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
  const expectTopColor = async (color) => {
    await expect(page.locator(".rah-mobile-status-canvas")).toHaveCSS(
      "background-color",
      color,
    );
    const safeTop = await page
      .locator(".rah-product-shell")
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingTop));
    for (const button of await page
      .locator(
        ".rah-task-detail-bar button:visible, .rah-channel-settings-header button:visible",
      )
      .all()) {
      const rect = await button.boundingBox();
      assert.ok(
        rect.y >= safeTop,
        "overlay header controls must clear the status background",
      );
    }
    await expect(page.locator("html")).toHaveCSS("background-color", color);
    await expect(page.locator(".app.rah-product-shell")).toHaveCSS(
      "background-color",
      color,
    );
    await expect
      .poll(() =>
        page.locator('meta[name="theme-color"]').evaluate((meta) => {
          const sample = document.createElement("span");
          sample.style.color = meta.content;
          return sample.style.color;
        }),
      )
      .toBe(color);
  };
  const yellow = "rgb(255, 212, 64)",
    white = "rgb(255, 255, 255)";
  await expect(nav).toBeVisible();
  await expectTopColor(yellow);
  await expect(page.locator("html")).toHaveCSS("position", "fixed");
  await expect(page.locator("body")).toHaveCSS("overscroll-behavior-y", "none");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 212, 64)",
  );
  await expect(
    page.locator(".rah-navigation-toggle,.rah-navigation-drawer"),
  ).toHaveCount(0);
  for (const name of ["首页", "任务", "成员", "设置"])
    await expect(nav.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(nav).toHaveJSProperty("innerText", "");
  assert.ok((await nav.boundingBox()).height <= 52, "icon-only bar is compact");
  await expect(nav).toHaveCSS("bottom", "8px");
  await expect(nav).toHaveCSS("background-color", "rgba(255, 255, 255, 0.55)");
  const home = page.locator(".rah-room-sidebar.is-open");
  await expect(home).toBeVisible();
  await expect(home.locator("[data-sidebar-key]").first()).toBeVisible();
  await page.waitForTimeout(600);
  assert.equal(
    new URL(page.url()).searchParams.has("room"),
    false,
    "Home must not serialize its hidden default Room as the launch route",
  );
  await page.reload();
  await expect(home).toBeVisible();
  await expect(nav).toBeVisible();
  for (const name of ["搜索", "动态"])
    await expect(home.getByRole("button", { name, exact: true })).toBeVisible();
  const notificationButton = home.getByRole("button", {
    name: "通知",
    exact: true,
  });
  await expect(notificationButton).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(notificationButton).toHaveCSS("box-shadow", "none");
  await notificationButton.tap();
  await expect(notificationButton).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  const inbox = page.getByRole("dialog", { name: "Human Inbox" });
  await expect(inbox).toBeVisible();
  await notificationButton.tap();
  await expect(inbox).toBeHidden();
  await expect(notificationButton).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await notificationButton.tap();
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
  await expectTopColor(white);
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(page.locator(".search-top .rah-panel-header-icon")).toBeHidden();
  assert.equal(
    (
      await page
        .getByRole("button", { name: "返回聊天", exact: true })
        .boundingBox()
    ).width,
    32,
  );
  assert.ok(
    (await input.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >=
      16,
  );
  assert.equal(await page.evaluate(() => visualViewport?.scale ?? 1), 1);
  await expect(nav).toBeHidden();
  await page.screenshot({ path: `${evidence}/search.png` });
  await page.getByRole("button", { name: "返回聊天", exact: true }).tap();
  await home.getByRole("button", { name: "动态", exact: true }).tap();
  const activityHead = page.locator(".activity-head");
  await expect(activityHead.locator(".rah-panel-header-icon")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "刷新动态", exact: true }),
  ).toBeHidden();
  const activityBack = page.getByRole("button", {
    name: "返回聊天",
    exact: true,
  });
  assert.ok(
    (await activityBack.boundingBox()).x <
      (await activityHead.locator(".channel-title").boundingBox()).x,
  );
  await expect(activityHead.locator(".channel-sub")).toBeVisible();
  await expectTopColor(white);
  await expect(activityHead.locator(".channel-sub")).toHaveText(
    /\d+ 条动态.*\d+ 条未读/,
  );
  await page.screenshot({ path: `${evidence}/activity.png` });
  await activityBack.tap();
  await nav.getByRole("button", { name: "任务", exact: true }).tap();
  const tasks = page.getByRole("main", { name: "全局任务" });
  await expect(tasks.locator(".channel-sub")).toBeVisible();
  await expectTopColor(yellow);
  assert.equal(
    (await tasks.locator("header").first().boundingBox()).height,
    60,
  );
  const views = tasks.getByRole("radiogroup", { name: "任务视图" });
  assert.ok(
    await views.evaluate((e) => !!e.closest("header")),
    "mobile task view selector belongs to title header",
  );
  await expect(views.getByRole("radio").first()).toHaveCSS(
    "-webkit-tap-highlight-color",
    "rgba(0, 0, 0, 0)",
  );
  const off = views.locator('[aria-checked="false"]');
  await expect(off).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await off.hover();
  await expect(off).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await off.tap();
  await expect(views.locator('[aria-checked="false"]')).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  const selectedColor = await views
    .locator('[aria-checked="true"]')
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  assert.notEqual(
    selectedColor,
    "rgb(255, 255, 255)",
    "active differs from inactive",
  );
  assert.notEqual(
    selectedColor,
    await tasks
      .locator("header")
      .first()
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    "active is pale yellow on yellow title",
  );
  await page.mouse.move(0, 500);
  assert.equal(
    await views
      .locator('[aria-checked="true"]')
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    selectedColor,
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
  await page.screenshot({ path: `${evidence}/tasks-filtered.png` });
  await clear.tap();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${evidence}/tasks.png` });
  await tasks.locator(".rah-global-card-open").first().tap();
  const taskDetail = page.getByTestId("task-thread-modal");
  await expect(taskDetail).toBeVisible();
  await expectTopColor(white);
  await taskDetail
    .getByRole("button", { name: "返回任务页面", exact: true })
    .tap();
  await expectTopColor(yellow);
  for (const [label, shot] of [
    ["成员", "members"],
    ["设置", "settings"],
  ]) {
    await nav.getByRole("button", { name: label, exact: true }).tap();
    await expect(nav).toBeVisible();
    await expectTopColor(yellow);
    const rootHead = page.locator(
      label === "成员"
        ? ".rah-agent-sidebar-head"
        : ".rah-settings-mobile-index > header",
    );
    assert.equal((await rootHead.boundingBox()).height, 60);
    const rootIcon = rootHead.locator(".rah-panel-header-icon");
    await expect(rootIcon).toHaveCSS("border-top-width", "2px");
    assert.equal((await rootIcon.boundingBox()).width, 36);
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${evidence}/${shot}.png` });
  }
  await page
    .locator(".rah-settings-mobile-index")
    .getByRole("button", { name: "账户", exact: true })
    .tap();
  await expect(nav).toBeHidden();
  await expectTopColor(white);
  await page.getByRole("button", { name: "返回设置", exact: true }).tap();
  await expect(nav).toBeVisible();
  await expectTopColor(yellow);
  await page
    .locator(".rah-settings-mobile-index")
    .getByRole("button", { name: "计算机", exact: true })
    .tap();
  await expect(nav).toBeHidden();
  await page.locator(".rah-computer-row").tap();
  await page.getByRole("button", { name: "返回计算机列表", exact: true }).tap();
  await page.getByRole("button", { name: "返回设置", exact: true }).tap();
  await expect(nav).toBeVisible();
  await nav.getByRole("button", { name: "成员", exact: true }).tap();
  await page.locator(".rah-agent-member-row").first().tap();
  await expect(nav).toBeHidden();
  await expectTopColor(white);
  await page.getByRole("button", { name: "返回成员列表", exact: true }).tap();
  await expect(nav).toBeVisible();
  await expectTopColor(yellow);
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
  assert.equal(
    (
      await page
        .locator(".rah-conversation-head .rah-panel-header-icon")
        .boundingBox()
    ).width,
    36,
  );
  await page.screenshot({ path: `${evidence}/room.png` });
  await expectTopColor(white);
  await page.getByRole("button", { name: "频道详情与设置", exact: true }).tap();
  const closeSettings = page.getByRole("button", {
    name: "关闭频道设置",
    exact: true,
  });
  await expect(closeSettings.locator("svg use")).toHaveAttribute("href", /x$/);
  await page.waitForTimeout(350);
  const settingsHead = await page
    .locator(".rah-channel-settings-header")
    .boundingBox();
  assert.equal(settingsHead.height, 60);
  await expectTopColor(yellow);
  await page.screenshot({ path: `${evidence}/channel-settings.png` });
  const closeBox = await closeSettings.boundingBox();
  assert.ok(
    Math.abs(
      closeBox.y +
        closeBox.height / 2 -
        settingsHead.y -
        settingsHead.height / 2,
    ) <= 1,
  );
  await closeSettings.tap();
  await expectTopColor(white);
  await page.getByRole("tab", { name: "任务", exact: true }).tap();
  const roomToolbar = page.locator('.chan-pane [aria-label="任务筛选与视图"]');
  const create = roomToolbar.getByRole("button", {
    name: "新建任务",
    exact: true,
  });
  const roomViews = roomToolbar.getByRole("radiogroup", { name: "任务视图" });
  const assertToolbar = async () => {
    const first = await roomToolbar
      .getByRole("button", { name: /^创建者/ })
      .boundingBox();
    const second = await roomToolbar
      .getByRole("button", { name: /^负责人/ })
      .boundingBox();
    const createBox = await create.boundingBox(),
      viewBox = await roomViews.boundingBox();
    assert.equal(first.y, second.y);
    assert.equal(
      createBox.y + createBox.height / 2,
      first.y + first.height / 2,
    );
    if (viewBox.x + viewBox.width > 390)
      await expect(roomToolbar.locator(".tasks-toolbar-row")).toHaveCSS(
        "overflow-x",
        "auto",
      );
    assert.ok(
      Math.abs(
        createBox.y + createBox.height / 2 - viewBox.y - viewBox.height / 2,
      ) <= 1,
    );
  };
  await assertToolbar();
  await roomToolbar.getByRole("button", { name: /^创建者/ }).tap();
  await page.getByRole("menuitemcheckbox").first().tap();
  await page.keyboard.press("Escape");
  await assertToolbar();
  await roomToolbar.getByRole("button", { name: /^负责人/ }).tap();
  await page.getByRole("menuitemcheckbox").first().tap();
  await page.keyboard.press("Escape");
  await assertToolbar();
  await expect(
    roomToolbar.getByRole("button", { name: "全部清除", exact: true }),
  ).toBeHidden();
  await expect(create).toHaveJSProperty("innerText", "新建任务");
  for (const mode of ["看板", "列表"]) {
    await roomViews.getByRole("radio", { name: mode }).tap();
    await expect(roomViews.locator('[aria-checked="true"]')).toHaveCSS(
      "background-color",
      "rgb(255, 212, 64)",
    );
    const inactive = roomViews.locator('[aria-checked="false"]');
    await inactive.hover();
    await expect(inactive).toHaveCSS("background-color", "rgb(255, 255, 255)");
  }
  await page.screenshot({ path: `${evidence}/room-tasks-filtered.png` });
  await page.getByRole("tab", { name: "聊天", exact: true }).tap();
  await page.getByRole("button", { name: "返回主页", exact: true }).tap();
  await expect(nav).toBeVisible();
  await home
    .locator('[data-sidebar-group="dms"] [data-sidebar-key] button')
    .first()
    .tap();
  await expect(nav).toBeHidden();
  assert.equal(
    (
      await page
        .locator(".rah-conversation-head .rah-agent-avatar.is-header")
        .boundingBox()
    ).width,
    36,
  );
  await page.screenshot({ path: `${evidence}/direct.png` });
  await expectTopColor(white);
  await page.getByRole("button", { name: "返回主页", exact: true }).tap();
  await expect(nav).toBeVisible();
  await expectTopColor(yellow);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${evidence}/home.png` });
  await page.goto(
    `${fixture.origin}/?surface=settings&inputRequest=fixture-notification-link`,
  );
  await expect(inbox).toBeVisible();
  await expect(home).toBeVisible();
  await expect
    .poll(async () => {
      const linkedPopup = await inbox.boundingBox();
      return (
        linkedPopup !== null &&
        linkedPopup.x >= 0 &&
        linkedPopup.x + linkedPopup.width <= 390
      );
    })
    .toBe(true);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(nav).toBeHidden();
  await expect(page.locator(".rah-product-shell > .rail")).toBeVisible();
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
    "content",
    "#ffd440",
  );
  console.log("PASS mobile native-style tabs", evidence);
} finally {
  await browser.close();
  await fixture.close();
}
