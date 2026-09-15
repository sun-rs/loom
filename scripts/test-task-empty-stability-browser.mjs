import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  // Isolated fixture: an already-loaded empty task result must survive background sync.
  await page.route("**/v3/client/tasks/list", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), tasks: [] },
    });
  });
  await page.goto(fixture.origin);
  await page
    .locator(`[data-sidebar-key="room:${fixture.roomId}"] button`)
    .first()
    .tap();
  await page.getByRole("tab", { name: "任务", exact: true }).tap();
  await expect(page.getByText("暂无任务", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^创建者/ }).tap();
  await page.getByRole("menuitemcheckbox").first().tap();
  await page.keyboard.press("Escape");
  const empty = page.getByText("没有符合此筛选的任务", { exact: true });
  await expect(empty).toBeVisible();
  const node = await empty.elementHandle();
  let release, started;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const pending = new Promise((resolve) => {
    started = resolve;
  });
  await page.route("**/v3/client/rooms/sync", async (route) => {
    started();
    await held;
    await route.continue();
  });
  try {
    await Promise.race([
      pending,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("no background sync")), 15000),
      ),
    ]);
    await expect(empty).toBeVisible({ timeout: 500 });
    assert.ok(
      await node.evaluate((e) => e.isConnected),
      "empty result must not remount during refresh",
    );
  } finally {
    release();
  }
  console.log("Task empty-result stability passed");
} finally {
  await browser.close();
  await fixture.close();
}
