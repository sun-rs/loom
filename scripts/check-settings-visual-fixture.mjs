import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
import { createServer } from "vite";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
const output = process.env.RAH_VISUAL_OUTPUT ?? "/tmp/rah-settings-visual";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: await findChromeExecutable(),
  headless: true,
});
try {
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await page.goto(`${origin}/test/settings-visual-fixture.html`);
    const group = page.getByRole("group", { name: "消息字号" });
    await group.waitFor();
    const dimensions = await group.evaluate((el) => ({
      gap: getComputedStyle(el).gap,
      buttons: [...el.querySelectorAll("button")].map((button) => ({
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
        shadow: getComputedStyle(button).boxShadow,
      })),
    }));
    assert.equal(dimensions.gap, "4px");
    for (const b of dimensions.buttons) {
      assert.equal(b.width, 32);
      assert.equal(b.height, 32);
      assert.equal(b.shadow, "none");
    }
    await group.getByRole("button", { name: "大", exact: true }).click();
    await page.reload();
    assert.equal(
      await group
        .getByRole("button", { name: "大", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .locator(".rah-settings-message-preview .rah-agent-avatar-presence")
        .count(),
      1,
    );
    assert.equal(
      await page
        .locator(".rah-settings-message-preview [data-online]")
        .getAttribute("data-online"),
      "true",
    );
    await page.screenshot({
      path: `${output}/appearance-${viewport.width}.png`,
    });
    await page.goto(`${origin}/test/settings-visual-fixture.html?about=1`);
    const cards = await page
      .locator(".rah-settings-readonly-card")
      .evaluateAll((nodes) =>
        nodes.map((el) => ({
          border: getComputedStyle(el).borderColor,
          shadow: getComputedStyle(el).boxShadow,
          padding: getComputedStyle(el).padding,
        })),
      );
    assert.equal(cards.length, 3);
    for (const card of cards) {
      assert.equal(card.border, "rgba(0, 0, 0, 0.3)");
      assert.equal(card.shadow, "none");
      assert.equal(card.padding, "12px 16px");
    }
    await page.getByRole("button", { name: "帮助", exact: true }).click();
    const feedback = page.getByRole("link", { name: "反馈", exact: true });
    await feedback.waitFor();
    assert.equal(
      await feedback.getAttribute("href"),
      "/?surface=settings&settingsSection=feedback",
    );
    await page.keyboard.press("Escape");
    await feedback.waitFor({ state: "hidden" });
    await page.screenshot({ path: `${output}/about-${viewport.width}.png` });
    await page.close();
  }
  console.log(`Settings visual Chrome fixture passed: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
