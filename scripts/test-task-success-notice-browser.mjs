import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture(),
  browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(fixture.origin + "/?surface=tasks");
  const card = page
    .locator("[data-task-id]")
    .filter({ hasText: "Keep the Room-first delivery contract" })
    .first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /任务 #\d+ 状态：/ }).click();
  const response = page.waitForResponse(
    (r) =>
      r.url().includes("/tasks/") &&
      r.request().method() === "POST" &&
      !r.url().endsWith("/list"),
  );
  await page
    .getByRole("menuitemradio", { name: "已关闭", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(page.locator(".rah-task-drag-notice")).not.toContainText(
    "正在核验",
  );
  await expect(page.getByText(/任务 #\d+ 已更新/)).toHaveCount(0);
  await expect(page.locator(".rah-task-drag-notice")).toBeHidden();
  console.log("PASS task transition succeeds without a persistent success row");
} finally {
  await browser.close();
  await fixture.close();
}
