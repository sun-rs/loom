import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browserName = process.env.RAH_BROWSER ?? "chromium";
const browser = await (browserName === "webkit" ? webkit : chromium).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${fixture.origin}/?surface=room`);
    const row = page
      .locator(".rah-sidebar-channel-entry button")
      .filter({ hasText: "Agent Council" })
      .first();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "归档", exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toHaveAccessibleName("归档频道");
    await expect(confirmation).toHaveCSS("max-width", "384px");
    await expect(confirmation.locator("header")).toHaveCSS(
      "border-bottom-width",
      "0px",
    );
    await expect(
      confirmation.getByRole("button", { name: "归档频道", exact: true }),
    ).toHaveCSS("background-color", "rgb(248, 161, 111)");
    await expect(confirmation).toHaveCSS("padding", "24px");
    await expect(confirmation.locator("header h2")).toHaveCSS(
      "font-size",
      "18px",
    );
    await expect(confirmation.locator("footer")).toHaveCSS("gap", "12px");
    const box = await confirmation.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    await page.screenshot({ path: `/tmp/rah-archive-dialog-${width}.png` });
    await confirmation
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "归档", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
  await page
    .getByRole("button", { name: "频道详情与设置", exact: true })
    .click();
  await page
    .locator(".rah-channel-settings-operations .rah-channel-archive-button")
    .click();
  await page
    .getByRole("dialog", { name: "归档频道", exact: true })
    .getByRole("button", { name: "归档频道", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "归档频道", exact: true })
    .waitFor({ state: "detached" });
  await page.goto(`${fixture.origin}/?surface=settings&settingsSection=server`);
  const archives = page.getByRole("region", { name: "已归档频道" });
  await archives.waitFor();
  await archives.locator(".rah-settings-archive-name").first().click();
  await expect(
    page.locator("main.channel .rah-conversation-head"),
  ).toBeVisible();
  await expect(page.locator(".rah-channel-archived-badge")).toHaveText(
    "已归档",
  );
  await expect(page.locator("main.channel form.composer")).toHaveCount(0);
  await expect(
    page
      .locator(".rah-chat-system-notice")
      .filter({ hasText: " archived this channel" }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const badge = page.locator(".rah-channel-archived-badge");
    await expect(badge).toBeVisible();
    const box = await badge.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    await expect(page.locator(".rah-channel-archived-notice")).toBeVisible();
    await page.screenshot({
      path: `/tmp/rah-archived-view-${browserName}-${width}.png`,
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".rah-channel-archived-notice button").click();
  await expect(
    page
      .locator(".rah-channel-settings-operations")
      .getByRole("button", { name: "取消归档频道", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".rah-channel-archived-badge")).toBeVisible();
  await page
    .locator(".rah-channel-settings-operations")
    .getByRole("button", { name: "取消归档频道", exact: true })
    .click();
  await expect(
    page.locator("main.channel form.composer textarea"),
  ).toBeEnabled();
  await expect(page.locator("main.channel .rah-panel-title")).toHaveText(
    "Agent Council",
  );
  await expect(
    page.locator(
      ".rah-channel-settings-operations .rah-channel-archive-button",
    ),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(".rah-channel-settings-layer")).toHaveCount(0);
  await expect(
    page
      .locator(".rah-chat-system-notice")
      .filter({ hasText: " unarchived this channel" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "频道详情与设置", exact: true })
    .click();
  await page
    .locator(".rah-channel-settings-operations .rah-channel-archive-button")
    .click();
  await page
    .getByRole("dialog", { name: "归档频道", exact: true })
    .getByRole("button", { name: "归档频道", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "归档频道", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".rah-channel-archived-badge")).toBeVisible();
  await page.reload();
  await expect(page.locator(".rah-channel-archived-notice")).toBeVisible();
  await page.goto(`${fixture.origin}/?surface=settings&settingsSection=server`);
  await archives.getByRole("button", { name: "取消归档", exact: true }).click();
  await archives.waitFor({ state: "detached" });
  assert.match(page.url(), /surface=settings/);
  await page.reload();
  await page
    .getByRole("heading", { name: "服务器资料", exact: true })
    .waitFor();
  assert.equal(await archives.count(), 0);
  await page.goto(`${fixture.origin}/?room=${fixture.roomId}`);
  await expect(
    page.locator("main.channel form.composer textarea"),
  ).toBeEnabled();
  await expect(page.locator(".rah-channel-archived-badge")).toHaveCount(0);
  await expect(
    page
      .locator(".rah-chat-system-notice")
      .filter({ hasText: " unarchived this channel" }),
  ).toHaveCount(2);
  console.log(
    "Archived channel: real Kernel archive, Settings preview, unarchive, reload and writable Room passed.",
  );
} finally {
  await browser.close();
  await fixture.close();
}
