import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browserName = process.env.RAH_BROWSER ?? "chromium";
const browser = await (browserName === "webkit" ? webkit : chromium).launch();
try {
  const page = await browser.newPage();
  await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
  const row = page
    .locator(".rah-sidebar-channel-entry button.channel-row")
    .filter({ hasText: "Agent Council" })
    .first();
  await expect(row).toHaveClass(/is-selected/);
  await row.click();
  await expect(page.getByText("选择一个频道", { exact: true })).toBeVisible();
  await expect(row).not.toHaveClass(/is-selected/);
  await page.mouse.move(700, 500);
  await page.screenshot({
    path: `/tmp/rah-channel-deselect-${browserName}.png`,
  });
  assert.equal(new URL(page.url()).searchParams.has("room"), false);
  await page.reload();
  await expect(page.getByText("选择一个频道", { exact: true })).toBeVisible();
  await row.click();
  await expect(page.locator("main.channel h1")).toHaveText("Agent Council");
  await page.goBack();
  await expect(page.getByText("选择一个频道", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.locator("main.channel h1")).toHaveText("Agent Council");
  await page.goBack();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("complementary", { name: "Room 列表" }),
  ).toBeVisible();
  await expect(row).toBeVisible();
  await page.screenshot({
    path: `/tmp/rah-deselected-mobile-${browserName}.png`,
  });
  await page.reload();
  await page.locator(".rah-sidebar-channel-entry").first().waitFor();
  await row.click();
  await expect(page.locator("main.channel h1")).toHaveText("Agent Council");
  console.log("channel deselection, reload, reopening and back passed");
} finally {
  await browser.close();
  await fixture.close();
}
