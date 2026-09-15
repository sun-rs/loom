import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_TASK_ASSIGNMENT = "1";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_MOBILE_ENGINE === "webkit" ? webkit : chromium
).launch();
const evidence = mkdtempSync(`${tmpdir()}/rah-mobile-interaction-`);
const failures = [];
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  page.setDefaultTimeout(10000);
  const nav = page.getByRole("navigation", { name: "移动端主导航" });
  async function check(name, fn) {
    try {
      await fn();
      await page.screenshot({ path: `${evidence}/${name}.png` });
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
    }
  }
  await check("saved-return", async () => {
    await page.goto(fixture.origin);
    await page.getByRole("button", { name: "已保存", exact: true }).tap();
    await page.getByRole("button", { name: "返回主页", exact: true }).tap();
    await expect(nav).toBeVisible();
    await expect(page.locator(".sidebar-bookmarks.is-selected")).toHaveCount(0);
  });
  await check("settings-index", async () => {
    await page.goto(fixture.origin + "/?surface=settings");
    const index = page.locator(".rah-settings-mobile-index");
    await expect(index).toBeVisible();
    await expect(index.locator(".is-active,[aria-current=page]")).toHaveCount(
      0,
    );
    for (const name of ["账户", "外观"]) {
      await index.getByRole("button", { name, exact: true }).tap();
      await expect(nav).toBeHidden();
      await page.getByRole("button", { name: "返回设置", exact: true }).tap();
      await expect(nav).toBeVisible();
      await expect(index.locator(".is-active,[aria-current=page]")).toHaveCount(
        0,
      );
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(
      page
        .locator(".rah-settings-navigation")
        .first()
        .locator("[aria-current=page]"),
    ).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await check("members-index", async () => {
    await page.goto(fixture.origin + "/?surface=agents");
    const row = page.locator(".rah-agent-member-row").first();
    await expect(row).toBeVisible();
    await expect(
      page.locator(".rah-agent-directory-list .is-selected"),
    ).toHaveCount(0);
    await row.tap();
    await page.getByRole("button", { name: "返回成员列表", exact: true }).tap();
    await expect(nav).toBeVisible();
    await expect(page.locator(".rah-agent-member-row.is-selected")).toHaveCount(
      0,
    );
  });
  await check("computers-index", async () => {
    await page.goto(fixture.origin + "/?surface=computers");
    const row = page.locator(".rah-computer-row");
    await expect(row).toBeVisible();
    await expect(row).not.toHaveClass(/is-selected/);
    await row.tap();
    await page
      .getByRole("button", { name: "返回计算机列表", exact: true })
      .tap();
    await expect(row).not.toHaveClass(/is-selected/);
  });
  await check("task-touch", async () => {
    await page.goto(fixture.origin + "/?surface=tasks");
    const tasks = page.getByRole("main", { name: "全局任务" });
    for (const name of ["频道", "创建者", "负责人"])
      await expect(tasks.getByRole("button", { name, exact: true })).toHaveCSS(
        "-webkit-tap-highlight-color",
        "rgba(0, 0, 0, 0)",
      );
  });
  await page.goto(fixture.origin + "/?surface=tasks");
  const card = page
    .locator(".rah-global-card-open")
    .filter({ hasText: "Keep the Room-first delivery contract" })
    .first();
  await expect(card).toBeVisible();
  const roomId = await card.evaluate(
    (e) => e.closest("[data-task-room-id]").dataset.taskRoomId,
  );
  await check("create-label", async () => {
    await page.goto(`${fixture.origin}/?room=${roomId}&roomTab=tasks`);
    await expect(page.locator(".rah-task-create")).toHaveJSProperty(
      "innerText",
      "新建任务",
    );
    await expect(page.locator(".rah-task-create")).toHaveCSS(
      "-webkit-tap-highlight-color",
      "rgba(0, 0, 0, 0)",
    );
  });
  await check("first-tap-thread", async () => {
    await page.goto(`${fixture.origin}/?room=${roomId}`);
    const preview = page.getByTestId("message-task-badge").first();
    await expect(preview).toBeVisible();
    // A touch ending on a child must not change its ancestor before native click.
    const message = preview.locator("xpath=ancestor::article");
    await preview.dispatchEvent("pointerdown", {
      pointerType: "touch",
      clientX: 20,
      clientY: 20,
    });
    await preview.dispatchEvent("pointerup", {
      pointerType: "touch",
      clientX: 20,
      clientY: 20,
    });
    await expect(message).not.toHaveAttribute("data-actions-open", "true");
    await preview.tap();
    const modal = page.getByTestId("task-thread-modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator("textarea")).toHaveCount(0);
    await modal
      .getByRole("button", { name: "关闭任务详情", exact: true })
      .tap();
    // Seed the reading-thread preview through the full task-card discussion.
    await page.goto(`${fixture.origin}/?room=${roomId}&roomTab=tasks`);
    await page.locator(".rah-global-card-open").first().tap();
    await expect(modal).toBeVisible();
    const reply = modal.getByRole("textbox", {
      name: "Thread 回复输入框",
      exact: true,
    });
    await expect(reply).toBeEnabled();
    await reply.fill("FAKE first-tap regression reply");
    await reply.press("Enter");
    await expect(
      modal
        .locator(".msg")
        .filter({ hasText: "FAKE first-tap regression reply" }),
    ).toBeVisible();
    await modal
      .getByRole("button", { name: "返回任务页面", exact: true })
      .tap();
    await page.goto(`${fixture.origin}/?room=${roomId}`);
    const threadPreview = page.locator(".thread-preview").first();
    await expect(threadPreview).toBeVisible();
    await threadPreview.tap();
    await expect(page.getByTestId("thread-side-column")).toBeVisible();
    await expect(page.getByTestId("task-thread-modal")).toHaveCount(0);
  });
  await check("long-press-next-touch", async () => {
    await page.goto(`${fixture.origin}/?room=${roomId}`);
    const badge = page.getByTestId("message-task-badge").first();
    await expect(badge).toBeVisible();
    const message = badge.locator("xpath=ancestor::article");
    const touchStart = (el) => {
      const event = new Event("touchstart", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "touches", {
        value: [{ clientX: 100, clientY: 200 }],
      });
      el.dispatchEvent(event);
    };
    await message.locator(".msg-head").evaluate(touchStart);
    await page.waitForTimeout(550);
    // No touchend: a cancelled long press must not poison the next child gesture.
    await page.keyboard.press("Escape");
    await badge.evaluate(touchStart);
    const delivered = await badge.evaluate((el) =>
      el.dispatchEvent(
        new Event("touchend", { bubbles: true, cancelable: true }),
      ),
    );
    assert.equal(
      delivered,
      true,
      "interactive child touch must not inherit long-press preventDefault",
    );
    await badge.tap();
    await expect(page.getByTestId("task-thread-modal")).toBeVisible();
  });
  console.log(JSON.stringify({ evidence, failures }, null, 2));
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await fixture.close();
}
