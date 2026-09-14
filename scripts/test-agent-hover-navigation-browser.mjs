import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "firefox" ? firefox : chromium
).launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(fixture.origin + "/?room=" + fixture.roomId);
  await page
    .getByRole("textbox", { name: "消息输入框", exact: true })
    .fill("Fixture: reply for hover navigation verification");
  await page
    .getByRole("textbox", { name: "消息输入框", exact: true })
    .press("Enter");
  const avatar = page
    .locator(".rah-message-avatar-trigger:has(.rah-agent-avatar)")
    .first();
  await avatar.hover();
  const preview = page.locator(".rah-agent-preview");
  const activity = preview.getByRole("button", {
    name: "最近动态",
    exact: true,
  });
  await activity.click();
  const panel = page.getByRole("main", { name: "Agent 详情侧栏", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.locator('[aria-selected="true"]')).toHaveText("动态");
  await panel.getByRole("tab", { name: "资料", exact: true }).click();
  await expect(panel.locator('[aria-selected="true"]')).toHaveText("资料");
  await avatar.hover();
  await activity.click();
  await expect(panel.locator('[aria-selected="true"]')).toHaveText("动态");
  assert.equal(await preview.count(), 0);
  console.log(
    "Agent hover opens Activity, including same-Agent Profile -> Activity",
  );
} finally {
  await browser.close();
  await fixture.close();
}
