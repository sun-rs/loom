import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_TASK_ASSIGNMENT = "1";
const fixture = await startShellFixture(),
  browser = await chromium.launch();
try {
  for (const iosPwa of [false, true]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      ...(iosPwa
        ? {
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
            isMobile: true,
            hasTouch: true,
          }
        : {}),
    });
    if (iosPwa)
      await page.addInitScript(() =>
        Object.defineProperty(navigator, "standalone", { value: true }),
      );
    await page.goto(fixture.origin + "/?surface=tasks");
    const card = page
      .locator(".rah-global-card-open")
      .filter({ hasText: "Keep the Room-first delivery contract" })
      .first();
    await expect(card).toBeVisible();
    const roomId = await card.evaluate(
      (e) => e.closest("[data-task-room-id]").dataset.taskRoomId,
    );
    await page.goto(fixture.origin + "/?room=" + roomId);
    await page.getByTestId("message-task-badge").first().click();
    const modal = page.getByTestId("task-thread-modal");
    await expect(modal).toBeVisible();
    if (iosPwa) {
      await expect(modal).toHaveAttribute(
        "data-mobile-presentation",
        "compact",
      );
      await expect(modal.locator("textarea")).toHaveCount(0);
    } else {
      await expect(modal.locator("textarea")).toBeVisible();
      await expect(
        modal.getByRole("button", { name: "返回任务页面" }),
      ).toBeVisible();
      await expect(
        modal.getByRole("button", { name: "关闭任务详情", exact: true }),
      ).toBeHidden();
      assert.equal(Math.round((await modal.boundingBox()).width), 390);
    }
    await page.close();
  }
  console.log("PASS narrow desktop full discussion / iOS PWA compact approval");
} finally {
  await browser.close();
  await fixture.close();
}
