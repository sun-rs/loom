import assert from "node:assert/strict";
import { chromium, expect } from "playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

const fixture = await startShellFixture();
const browser = await chromium.launch();
const evidence = mkdtempSync(`${tmpdir()}/rah-mobile-viewport-`);
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 59, bottom: 34, left: 0, right: 0 },
  });
  async function pan(target, direction) {
    const box = await target.boundingBox();
    const x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }],
    });
    for (let i = 1; i <= 6; i++) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: y + direction * i * 8 }],
      });
      await page.waitForTimeout(30);
    }
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(200);
  }
  const nav = page.getByRole("navigation", { name: "移动端主导航" });
  for (const [surface, selector] of [
    ["room", ".rah-room-sidebar.is-open > .sidebar-head"],
    ["tasks", ".rah-discovery > .activity-head"],
    ["agents", ".rah-agent-sidebar-head"],
    ["settings", ".rah-settings-mobile-index > header"],
  ]) {
    await page.goto(`${fixture.origin}/?surface=${surface}`);
    const header = page.locator(selector);
    await expect(header).toBeVisible();
    await expect(nav).toBeVisible();
    await expect(page.locator("html")).toHaveCSS(
      "background-color",
      "rgb(255, 212, 64)",
    );
    const before = await header.boundingBox(),
      footer = await nav.boundingBox();
    assert.equal(
      before.y,
      59,
      "header begins below the emulated status safe area",
    );
    for (const direction of [-1, 1]) {
      await pan(header, direction);
      assert.deepEqual(await header.boundingBox(), before);
      assert.deepEqual(await nav.boundingBox(), footer);
      assert.equal(await page.evaluate(() => window.scrollY), 0);
    }
    await page.screenshot({ path: `${evidence}/${surface}-safe-area.png` });
  }
  await page.goto(`${fixture.origin}/?room=${fixture.roomId}`, {
    waitUntil: "networkidle",
  });
  const header = page.locator("main.channel > header"),
    composer = page.locator("main.channel .composer");
  await expect(composer).toBeVisible();
  await expect(header).toBeVisible();
  const before = await header.boundingBox(),
    bottom = await composer.boundingBox();
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await pan(header, -1);
  await pan(composer, 1);
  assert.deepEqual(await header.boundingBox(), before);
  assert.deepEqual(await composer.boundingBox(), bottom);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.screenshot({ path: `${evidence}/room-safe-area.png` });
  console.log(
    JSON.stringify({
      passed: true,
      evidence,
      simulatedSafeArea: { top: 59, bottom: 34 },
    }),
  );
} finally {
  await browser.close();
  await fixture.close();
}
