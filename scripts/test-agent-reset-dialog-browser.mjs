import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(`${fixture.origin}/?surface=agents`);
  await page
    .locator(
      ".rah-agent-sidebar-section:not(.rah-agent-human-section) .rah-agent-member-row",
    )
    .first()
    .click();
  await page
    .locator(".rah-agent-detail-head")
    .getByRole("button", { name: "重启 / 重置", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("form")).toHaveCSS("padding", "0px");
  await expect(dialog.locator("form")).toHaveCSS("gap", "20px");
  await expect(dialog.locator("footer")).toHaveCSS("gap", "12px");
  await expect(dialog.locator("h2")).toContainText("重新启动");
  await expect(dialog.locator("h2")).toHaveCSS("text-transform", "uppercase");
  await expect(
    dialog.getByRole("button", { name: "重新启动", exact: true }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(dialog).toHaveCSS("padding", "24px");
    await page.screenshot({
      path: `/tmp/rah-reset-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
    });
  }
  await dialog.locator('input[value="session"]').check({ force: true });
  await expect(
    dialog.getByRole("button", { name: "重置会话并重启", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
} finally {
  await browser.close();
  await fixture.close();
}
