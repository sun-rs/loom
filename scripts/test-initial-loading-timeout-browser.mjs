import { chromium, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let blocked = true;
  await page.route("**/v3/client/health", (route) =>
    blocked ? undefined : route.continue(),
  );
  await page.goto(`${fixture.origin}/?surface=tasks`);
  await expect(
    page.locator(".rah-boot-loading .rah-loading-state"),
  ).toBeVisible();
  await expect(page.locator(".rah-boot-loading")).toHaveCSS(
    "background-color",
    "rgb(255, 250, 239)",
  );
  await expect(page.getByRole("alert")).toContainText("连接超时", {
    timeout: 18000,
  });
  blocked = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("main", { name: "全局任务" })).toBeVisible();
  console.log(
    "PASS initial timeout exits loading and retry restores the application",
  );
} finally {
  await browser.close();
  await fixture.close();
}
