import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const engine = process.env.RAH_BROWSER ?? "chromium";
const browser = await (engine === "webkit" ? webkit : chromium).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 844 },
  });
  // Recovery polling must not be needed to reveal a successfully reopened DM.
  await page.addInitScript(() => {
    const interval = window.setInterval.bind(window);
    window.setInterval = (handler, delay, ...args) =>
      interval(handler, delay === 5000 ? 60000 : delay, ...args);
  });
  page.setDefaultTimeout(15000);
  const nav = page.getByRole("navigation", { name: "主导航", exact: true });
  await page.goto(`${fixture.origin}/?surface=agents`);
  const rows = page.locator(
    ".rah-agent-sidebar-section:not(.rah-agent-human-section) .rah-agent-member-row",
  );
  await expect(rows.first()).toBeVisible();
  await expect(rows.first().locator("b")).toHaveCSS("font-size", "14px");
  await expect(rows.first().locator("small")).toHaveCSS("font-size", "12px");
  await expect(page.locator(".rah-agent-relationship")).toHaveCSS(
    "font-size",
    "14px",
  );
  await expect(page.locator(".rah-agent-relationship")).toHaveCSS(
    "font-weight",
    "500",
  );
  for (const header of await page
    .locator(".rah-agent-sidebar-section > header")
    .all()) {
    await expect(header.locator("b")).toHaveCSS("font-size", "12px");
    await expect(header.locator("b")).toHaveCSS("letter-spacing", "1.2px");
    await expect(header.locator("span").first()).toHaveCSS("font-size", "12px");
    await expect(header.locator("span").first()).toHaveCSS(
      "font-weight",
      "700",
    );
  }
  await expect(
    page.locator(".rah-agent-human-section .rah-member-self"),
  ).toHaveCSS("font-size", "14px");
  await rows.nth(1).click();
  const selectedUrl = page.url();
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await page.reload();
  await nav.getByRole("button", { name: "Agent 与成员", exact: true }).click();
  await expect(page).toHaveURL(selectedUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".rah-agent-directory-page")).toHaveClass(
    /is-mobile-detail-open/,
  );
  await expect(page.locator(".rah-agent-directory-list")).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 844 });
  await page.getByRole("button", { name: "关系图", exact: true }).click();
  const relationshipUrl = page.url();
  await page.reload();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".rah-agent-directory-page")).toHaveClass(
    /is-mobile-detail-open/,
  );
  await page.setViewportSize({ width: 1440, height: 844 });
  await nav.getByRole("button", { name: "聊天", exact: true }).click();
  await nav.getByRole("button", { name: "Agent 与成员", exact: true }).click();
  await expect(page).toHaveURL(relationshipUrl);
  await rows.first().locator(".rah-agent-avatar").dblclick();
  await expect(page.locator("main.channel .composer")).toBeVisible();
  await expect(
    page.locator(".rah-direct-room-row[aria-current=page]"),
  ).toBeVisible();
  const dmUrl = page.url();
  await page
    .locator(".sidebar-bookmarks")
    .filter({ hasText: "已保存" })
    .click();
  await expect(page).toHaveURL(/surface=saved/);
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await page.reload();
  await nav.getByRole("button", { name: "聊天", exact: true }).click();
  await expect(page).toHaveURL(/surface=saved/);
  await expect(page.locator(".sidebar-bookmarks.is-selected")).toHaveText(
    "已保存",
  );
  await page.goto(dmUrl);

  await page
    .locator("main.channel form.composer textarea")
    .fill("Fixture DM history retention probe");
  await page.locator("main.channel form.composer textarea").press("Enter");
  await expect(
    page
      .locator(".msg-body")
      .filter({ hasText: "Fixture DM history retention probe" })
      .first(),
  ).toBeVisible();
  console.log("first DM opened");
  await nav.getByRole("button", { name: "设置", exact: true }).click();
  await page.reload();
  await nav.getByRole("button", { name: "聊天", exact: true }).click();
  await expect(page).toHaveURL(dmUrl);
  const dmRow = page.locator(".rah-direct-room-row[aria-current=page]");
  const dmLabel = await dmRow.getAttribute("aria-label");
  await dmRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "关闭会话", exact: true }).click();
  await expect(
    page.getByRole("button", { name: dmLabel, exact: true }),
  ).toHaveCount(0);
  await nav.getByRole("button", { name: "Agent 与成员", exact: true }).click();
  // A pre-open sidebar response may arrive after the authoritative refresh.
  let releaseStale;
  let capturedStale;
  const captured = new Promise((resolve) => {
    capturedStale = resolve;
  });
  const released = new Promise((resolve) => {
    releaseStale = resolve;
  });
  let held = false;
  await page.route("**/v3/client/sidebar/get", async (route) => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    capturedStale();
    await released;
    await route.fulfill({ response });
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await captured;
  await rows.first().locator(".rah-agent-avatar").dblclick();
  await expect(page).toHaveURL(dmUrl);
  await expect(
    page.getByRole("button", { name: dmLabel, exact: true }),
  ).toBeVisible({ timeout: 1000 });
  const staleArrived = page.waitForResponse("**/v3/client/sidebar/get");
  releaseStale();
  await staleArrived;
  await page.unroute("**/v3/client/sidebar/get");
  await expect(
    page.getByRole("button", { name: dmLabel, exact: true }),
  ).toBeVisible();
  await expect(
    page
      .locator(".msg-body")
      .filter({ hasText: "Fixture DM history retention probe" })
      .first(),
  ).toBeVisible();
  await nav.getByRole("button", { name: "Agent 与成员", exact: true }).click();
  await page
    .locator(".rah-agent-human-section .rah-agent-member-row")
    .first()
    .click();
  const humanUrl = page.url();
  console.log("closed DM reopened; human selected");
  await page.reload();
  await expect(page).toHaveURL(humanUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".rah-agent-directory-list")).not.toBeVisible();
  await page.setViewportSize({ width: 1440, height: 844 });
  await nav.getByRole("button", { name: "聊天", exact: true }).click();
  await expect(page).toHaveURL(dmUrl);
  const channel = page
    .locator(".rah-sidebar-channel-entry button")
    .filter({ hasText: "Agent Council" })
    .first();
  await channel.click();
  await expect(page.locator("main.channel h1")).toHaveText("Agent Council");
  await page.locator(".rah-message-avatar-trigger").first().click();
  await nav.getByRole("button", { name: "Agent 与成员", exact: true }).click();
  await expect(page).toHaveURL(humanUrl);
  await nav.getByRole("button", { name: "聊天", exact: true }).click();
  await expect(page.locator("main.channel h1")).toHaveText("Agent Council");
  await channel.click();
  await expect(channel).toHaveCSS("font-weight", "500");
  await page.screenshot({ path: `/tmp/rah-surface-selection-${engine}.png` });
  console.log(
    `${engine}: member typography, surface memory, responsive detail and avatar double click passed`,
  );
} finally {
  await browser.close();
  await fixture.close();
}
