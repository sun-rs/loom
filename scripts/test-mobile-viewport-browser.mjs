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
    const canvas = page.locator(".rah-mobile-status-canvas");
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveCSS("background-color", "rgb(255, 212, 64)");
    await expect(canvas).toHaveCSS("position", "fixed");
    assert.deepEqual(
      await canvas.boundingBox(),
      {
        x: 0,
        y: 0,
        width: 390,
        height: 119,
      },
      "background covers the safe area and the 60px header behind the content",
    );
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
  await expect(page.locator(".rah-mobile-status-canvas")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await pan(header, -1);
  await pan(composer, 1);
  assert.deepEqual(await header.boundingBox(), before);
  assert.deepEqual(await composer.boundingBox(), bottom);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.screenshot({ path: `${evidence}/room-safe-area.png` });
  for (const [width, height, top] of [
    [430, 932, 20],
    [744, 390, 0],
    [390, 844, 59],
  ]) {
    await page.setViewportSize({ width, height });
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top, bottom: 0, left: 0, right: 0 },
    });
    await expect.poll(async () => (await header.boundingBox()).y).toBe(top);
    const canvas = await page
      .locator(".rah-mobile-status-canvas")
      .boundingBox();
    assert.equal(canvas.width, width);
    assert.equal(canvas.y, 0);
    assert.ok(
      canvas.height >= top && canvas.height > 10 && canvas.height < height / 2,
    );
    await expect(page.locator(".rah-mobile-status-canvas")).toHaveCSS(
      "pointer-events",
      "none",
    );
  }
  // The header background must never paint over a control, even when iOS owns
  // the status inset and reports zero. Compare actual pixels, not hit targets:
  // pointer-events:none still permits an opaque layer to hide a border.
  await page.setViewportSize({ width: 430, height: 932 });
  for (const top of [0, 5, 12, 59]) {
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top, bottom: 34, left: 0, right: 0 },
    });
    for (const [surface, selector] of [
      ["search", ".search-box"],
      ["tasks", ".activity-head .rah-panel-header-icon"],
      ["agents", ".rah-agent-sidebar-head .rah-panel-header-icon"],
      ["settings", ".rah-settings-mobile-index .rah-panel-header-icon"],
      ["room", ".rah-mobile-home-workspace"],
    ]) {
      await page.goto(`${fixture.origin}/?surface=${surface}`, {
        waitUntil: "networkidle",
      });
      const control = page.locator(selector);
      await expect(control).toBeVisible();
      assert.equal(
        await control.evaluate(
          (el) => getComputedStyle(el.closest("header")).position,
        ),
        "sticky",
        "when the system inset is zero the header itself supplies a non-viewport fixed edge",
      );
      await page.evaluate(() => document.fonts.ready);
      const strip = page.locator(".rah-mobile-status-canvas");
      const painted = await control.screenshot({ animations: "disabled" });
      await strip.evaluate((el) => {
        el.style.visibility = "hidden";
      });
      const uncovered = await control.screenshot({ animations: "disabled" });
      await strip.evaluate((el) => {
        el.style.removeProperty("visibility");
      });
      assert.deepEqual(
        painted,
        uncovered,
        `${surface}, inset ${top}: status background must not hide any control pixels`,
      );
      const rect = await control.boundingBox();
      assert.ok(
        rect.y >= top,
        `${surface}: controls respect the system safe area`,
      );
      await expect(page.locator(".app.rah-product-shell")).toHaveCSS(
        "padding-top",
        `${top}px`,
      );
      assert.equal(
        await strip.evaluate((el) =>
          el.parentElement.matches(".rah-product-shell"),
        ),
        true,
        "the background belongs to the shell, not a foreground body portal",
      );
      await expect(strip).toHaveCSS("z-index", "-1");
      await expect(page.locator(".rah-product-shell")).toHaveCSS(
        "isolation",
        "isolate",
      );
      if (top === 59) {
        const clip = { x: 0, y: 0, width: 430, height: top };
        const original = await page.screenshot({ clip });
        await strip.evaluate((el) => {
          el.style.backgroundColor = "rgb(0, 128, 255)";
        });
        assert.notDeepEqual(
          await page.screenshot({ clip }),
          original,
          "the negative background is visible in the safe area, not hidden behind the document",
        );
        assert.deepEqual(
          await control.screenshot({ animations: "disabled" }),
          painted,
          "even a contrasting background cannot paint above header controls",
        );
        await strip.evaluate((el) =>
          el.style.removeProperty("background-color"),
        );
      }
      if (top === 0 || top === 59)
        await page.screenshot({
          path: `${evidence}/${surface}-edge-${top}.png`,
        });
    }
  }
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
