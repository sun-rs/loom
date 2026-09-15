import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture(),
  browser = await (
    process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
  ).launch();
const evidence = mkdtempSync(`${tmpdir()}/rah-task-scope-`),
  failures = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({
      viewport: { width, height: width === 390 ? 844 : 900 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    await page.goto(fixture.origin + "/?surface=tasks");
    const card = page
      .locator(".rah-global-card-open")
      .filter({ hasText: "Keep the Room-first delivery contract" })
      .first();
    await expect(card).toBeVisible();
    const roomId = fixture.roomId;
    const otherRoomId = await card.evaluate(
      (e) => e.closest("[data-task-room-id]").dataset.taskRoomId,
    );
    const global = page.getByRole("main", { name: "全局任务" }),
      local = page.locator('.tasks-toolbar[data-task-scope="room"]');
    const filter = (scope, name) =>
      scope.getByRole("button", { name: new RegExp(`^${name}`) });
    async function check(name, fn) {
      try {
        await fn();
      } catch (e) {
        failures.push(`${width} ${name}: ${e.stack}`);
        await page.screenshot({
          path: `${evidence}/${width}-${name}-failure.png`,
        });
      }
    }
    async function selectTwo(scope, name) {
      await filter(scope, name).click();
      const options = page.getByRole("menuitemcheckbox");
      await expect(options.first()).toBeVisible();
      await options.nth(0).click();
      await options.nth(1).click();
      await page.keyboard.press("Escape");
      await expect(
        filter(scope, name).locator(".task-filter-count"),
      ).toHaveText("2");
    }
    async function home() {
      if (width === 390)
        await page
          .getByRole("navigation", { name: "主导航" })
          .getByRole("button", { name: "首页", exact: true })
          .click();
      else
        await page
          .getByRole("navigation", { name: "主导航" })
          .getByRole("button", { name: "聊天", exact: true })
          .click();
    }
    async function tasks() {
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: "任务", exact: true })
        .click();
    }
    async function roomTab() {
      await page
        .locator("main.channel .rah-panel-tabs")
        .getByRole("tab", { name: "任务", exact: true })
        .click();
    }
    const gaps = await global.evaluate((e) => ({
      filters: parseFloat(
        getComputedStyle(e.querySelector(".tasks-toolbar-row")).gap,
      ),
      views: parseFloat(getComputedStyle(e.querySelector(".tasks-view")).gap),
    }));
    await check("room-multiple-gap", async () => {
      await page.goto(`${fixture.origin}/?room=${roomId}&roomTab=tasks`);
      await expect(local).toBeVisible();
      await expect(
        local.getByRole("button", { name: "新建任务", exact: true }),
      ).toBeEnabled();
      await expect(filter(local, "创建者")).toBeVisible();
      const before = await filter(local, "创建者").evaluate(
        (e) => e.getBoundingClientRect().width,
      );
      assert.ok(before > 0);
      await selectTwo(local, "创建者");
      await selectTwo(local, "负责人");
      assert.ok(
        (await filter(local, "创建者").evaluate(
          (e) => e.getBoundingClientRect().width,
        )) > before,
      );
      assert.deepEqual(
        await local.evaluate((e) => ({
          filters: parseFloat(
            getComputedStyle(e.querySelector(".tasks-toolbar-row")).gap,
          ),
          views: parseFloat(
            getComputedStyle(e.querySelector(".tasks-view")).gap,
          ),
        })),
        gaps,
      );
      assert.ok(gaps.filters > gaps.views);
      if (width === 390) {
        const row = local.locator(".tasks-toolbar-row");
        assert.equal(
          await row.evaluate((e) => getComputedStyle(e).overflowX),
          "auto",
        );
        await local.getByRole("radio", { name: "列表", exact: true }).click();
        await expect(
          local.getByRole("radio", { name: "列表", exact: true }),
        ).toBeInViewport();
        assert.ok(
          await row.evaluate((e) => e.scrollLeft > 0),
          "overflowed actions are reachable without squeezing filters",
        );
        await row.evaluate((e) => {
          e.scrollLeft = 0;
        });
      }
      await page.screenshot({ path: `${evidence}/${width}-room-multiple.png` });
    });
    await check("room-visit-reset", async () => {
      // Going to a separate page and choosing the Room is a new visit.
      if (width === 390)
        await page
          .getByRole("button", { name: "返回主页", exact: true })
          .click();
      await tasks();
      await home();
      await page
        .locator(`[data-sidebar-key="room:${roomId}"] button`)
        .first()
        .click();
      await expect(
        page.getByRole("textbox", { name: "消息输入框", exact: true }),
      ).toBeVisible();
      await roomTab();
      await expect(local.locator(".task-filter-count")).toHaveCount(0);
    });
    await check("room-and-dm-reset", async () => {
      for (const target of ["room", "dm"]) {
        await selectTwo(local, "创建者");
        if (width === 390)
          await page
            .getByRole("button", { name: "返回主页", exact: true })
            .click();
        const row =
          target === "room"
            ? page
                .locator(`[data-sidebar-key="room:${otherRoomId}"] button`)
                .first()
            : page
                .locator('[data-sidebar-group="dms"] [data-sidebar-key] button')
                .first();
        await row.click();
        await expect(
          page.getByRole("textbox", { name: "消息输入框", exact: true }),
        ).toBeVisible();
        if (width === 390)
          await page
            .getByRole("button", { name: "返回主页", exact: true })
            .click();
        await page
          .locator(`[data-sidebar-key="room:${roomId}"] button`)
          .first()
          .click();
        await expect(
          page.getByRole("textbox", { name: "消息输入框", exact: true }),
        ).toBeVisible();
        await roomTab();
        await expect(local.locator(".task-filter-count")).toHaveCount(0);
      }
    });
    await check("global-session", async () => {
      if (width === 390)
        await page
          .getByRole("button", { name: "返回主页", exact: true })
          .click();
      await tasks();
      await selectTwo(global, "创建者");
      await selectTwo(global, "负责人");
      await filter(global, "频道").click();
      await page.getByRole("menuitemcheckbox").first().click();
      await page.keyboard.press("Escape");
      await home();
      await page
        .locator(`[data-sidebar-key="room:${roomId}"] button`)
        .first()
        .click();
      await expect(
        page.getByRole("textbox", { name: "消息输入框", exact: true }),
      ).toBeVisible();
      if (width === 390)
        await page
          .getByRole("button", { name: "返回主页", exact: true })
          .click();
      await tasks();
      await expect(
        filter(global, "创建者").locator(".task-filter-count"),
      ).toHaveText("2");
      await expect(
        filter(global, "负责人").locator(".task-filter-count"),
      ).toHaveText("2");
      await expect(
        filter(global, "频道").locator(".task-filter-count"),
      ).toHaveText("1");
      await page.reload();
      await expect(global).toBeVisible();
      await expect(global.locator(".task-filter-count")).toHaveCount(0);
    });
    await page.close();
  }
  console.log(JSON.stringify({ evidence, failures }, null, 2));
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await fixture.close();
}
