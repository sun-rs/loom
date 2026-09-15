import assert from "node:assert/strict";
import { chromium, firefox } from "playwright";
import { expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture();
const b = await (
  process.env.RAH_BROWSER === "firefox" ? firefox : chromium
).launch({ headless: true });
try {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  // Isolated fixture: keep the real sync lifecycle but make message pages empty.
  await p.route("**/v3/client/messages/list", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: {
        ...body,
        messages: [],
        cursorAfter: 0,
        cursorBefore: 0,
        hasMoreAfter: false,
        hasMoreBefore: false,
      },
    });
  });
  await p.goto(f.origin);
  await p.getByRole("button", { name: "新建频道", exact: true }).click();
  const dialog = p.getByRole("dialog", { name: "创建频道", exact: true });
  await dialog.getByPlaceholder("例如 ai-research").fill("empty-test");
  await dialog.getByRole("button", { name: "创建频道", exact: true }).click();
  await expect(dialog).toBeHidden();
  for (const group of ["channels", "dms"]) {
    if (group === "dms")
      await p
        .locator('[data-sidebar-group="dms"] [data-sidebar-key]')
        .first()
        .click();
    const empty = p.locator(".rah-chat-empty");
    await expect(empty).toBeVisible();
    await p.waitForTimeout(1000);
    await expect(empty).toBeVisible();
    const node = await empty.elementHandle();
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    let requested;
    const started = new Promise((resolve) => {
      requested = resolve;
    });
    await p.route("**/v3/client/rooms/sync", async (route) => {
      requested();
      await held;
      await route.continue();
    });
    await p.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await started;
    await p.waitForTimeout(250);
    assert.equal(
      await node.evaluate((el) => el.isConnected),
      true,
      "background sync must not replace the confirmed empty state",
    );
    await expect(empty).toBeVisible();
    await expect(empty).toHaveText("暂无消息");
    release();
    await p.waitForTimeout(500);
    await p.unroute("**/v3/client/rooms/sync");
    await expect(empty).toBeVisible();
    await p.setViewportSize({ width: 390, height: 844 });
    await expect(empty).toBeVisible();
    await p.screenshot({ path: `/tmp/rah-empty-${group}.png` });
    await p.setViewportSize({ width: 1440, height: 900 });
  }
  console.log(
    "Room/DM empty copy, retained DOM during delayed sync, desktop/mobile passed",
  );
} finally {
  await b.close();
  await f.close();
}
