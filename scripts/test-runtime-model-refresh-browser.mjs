import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const f = await startShellFixture();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/local/runtimes/list", async (route) => {
    if (!route.request().postDataJSON()?.refreshOfferId)
      return route.continue();
    await held;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "fixture refresh failure" } }),
    });
  });
  await page.goto(f.origin + "/?surface=agents");
  await page.locator(".rah-agent-member-row").first().click();
  await page
    .getByRole("button", { name: "编辑运行时配置", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "编辑运行时配置" });
  const refresh = dialog.getByRole("button", { name: "刷新模型", exact: true });
  await page.mouse.move(0, 0);
  const geometry = await refresh.evaluate((el) => {
    const icon = el.querySelector("svg").getBoundingClientRect();
    const label = el.parentElement
      .querySelector("span")
      .getBoundingClientRect();
    return {
      offset: Math.abs(icon.y + icon.height / 2 - label.y - label.height / 2),
      color: getComputedStyle(el).color,
    };
  });
  assert.ok(geometry.offset < 1, JSON.stringify(geometry));
  assert.equal(geometry.color, "rgb(0, 0, 0)");
  await refresh.click();
  const status = dialog
    .getByRole("status")
    .filter({ hasText: "正在检查此计算机上的模型…" });
  await status.waitFor();
  assert.equal(await status.textContent(), "正在检查此计算机上的模型…");
  assert.deepEqual(
    await status.evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.fontSize, s.color, s.borderLeftWidth, s.borderLeftColor];
    }),
    ["12px", "rgba(0, 0, 0, 0.6)", "2px", "rgba(0, 0, 0, 0.2)"],
  );
  assert.equal(await refresh.getAttribute("aria-busy"), "true");
  assert.equal(await refresh.isDisabled(), true);
  assert.notEqual(
    await refresh
      .locator("svg")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  const statusBox = await status.boundingBox();
  const effortBox = await dialog
    .getByRole("button", { name: /^推理强度：/ })
    .boundingBox();
  assert.ok(statusBox.y + statusBox.height < effortBox.y);
  await page.screenshot({ path: "/tmp/rah-runtime-refresh-loading.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  await page.screenshot({
    path: "/tmp/rah-runtime-refresh-loading-mobile.png",
  });
  release();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await status.count(), 0);
  assert.equal(await refresh.isEnabled(), true);
  assert.equal(
    await refresh
      .locator("svg")
      .evaluate((el) => getComputedStyle(el).animationName),
    "none",
  );
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  console.log(
    "Refresh alignment, contrast, pending animation/status and failure recovery passed",
  );
} finally {
  await browser.close();
  await f.close();
}
