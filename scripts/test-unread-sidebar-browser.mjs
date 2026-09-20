import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
process.env.RAH_FIXTURE_UNREAD_MATRIX = "1";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(`${fixture.origin}/?surface=room`);
  const channel = page
    .locator(".rah-sidebar-channel-entry .channel-row")
    .filter({ hasText: "Unread Matrix" });
  const direct = page.getByRole("button", { name: "私信 Alice", exact: true });
  for (const [row, name, count] of [
    [channel, ".rah-sidebar-channel-name", "3"],
    [direct, ".rah-direct-row-name", "2"],
  ]) {
    await expect(row).not.toHaveClass(/is-selected/);
    await expect(row.locator(name)).toHaveCSS("font-weight", "700");
    await expect(row.locator(".rah-room-unread")).toHaveText(count);
  }
  await page.screenshot({
    path: `/tmp/rah-unread-before-${process.env.RAH_BROWSER ?? "chromium"}.png`,
  });
  await page.reload();
  await expect(channel.locator(".rah-room-unread")).toHaveText("3");
  await expect(direct.locator(".rah-room-unread")).toHaveText("2");
  await channel.click();
  await expect(channel.locator(".rah-room-unread")).toHaveCount(0);
  await expect(channel.locator(".rah-sidebar-channel-name")).toHaveCSS(
    "font-weight",
    "700",
  );
  await channel.click();
  await expect(channel.locator(".rah-sidebar-channel-name")).toHaveCSS(
    "font-weight",
    "500",
  );
  await direct.click();
  await expect(direct.locator(".rah-room-unread")).toHaveCount(0);
  await channel.click();
  await expect(direct.locator(".rah-direct-row-name")).toHaveCSS(
    "font-weight",
    "500",
  );
  await page.reload();
  await expect(channel.locator(".rah-room-unread")).toHaveCount(0);
  await expect(direct.locator(".rah-room-unread")).toHaveCount(0);
  await page.screenshot({
    path: `/tmp/rah-unread-sidebar-${process.env.RAH_BROWSER ?? "chromium"}.png`,
  });
  console.log(
    "channel message+notice=3, DM messages=2, actual label bold/badge, click clear, deselect normal and reload passed",
  );
} finally {
  await browser.close();
  await fixture.close();
}
