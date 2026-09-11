import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(5000);
    await page.goto(
      server.resolvedUrls.local[0] +
        "test/runtime-guide-fixture.html?settingsSection=runtime",
    );
    await page.waitForURL("**settingsSection=administration");
    await page.getByRole("heading", { name: "管理", exact: true }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "Runtime", exact: true }).count(),
      0,
      "Standalone Runtime navigation is removed",
    );
    const iconExists = await page
      .locator(".rah-settings-page-icon use")
      .evaluate(async (node) => {
        const url = new URL(node.getAttribute("href"), location.href);
        const sprite = new DOMParser().parseFromString(
          await (await fetch(url.pathname)).text(),
          "image/svg+xml",
        );
        return sprite.getElementById(url.hash.slice(1)) !== null;
      });
    assert.equal(
      iconExists,
      true,
      "Settings header references a real shared icon",
    );
    await page.locator(".rah-runtime-settings-card").first().waitFor();
    assert.equal(
      await page.locator(".rah-runtime-settings-icon img").count(),
      4,
    );
    const cards = await page
      .locator(".rah-runtime-settings-card")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.getBoundingClientRect().toJSON()),
      );
    assert.ok(
      cards[1].y - cards[0].bottom >= 8,
      "Runtime entries have clear separation",
    );
    assert.ok(
      cards.every((card) => card.height <= 70),
      "Runtime cards stay compact",
    );
    const boxes = await page
      .locator(".rah-runtime-settings-card input")
      .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().x));
    assert.ok(
      boxes.every((x) => Math.abs(x - boxes[0]) < 1),
      "All checkboxes, including disabled ones, align vertically",
    );
    const icons = await page
      .locator(".rah-runtime-settings-icon img")
      .evaluateAll((nodes) =>
        nodes.map((n) => n.complete && n.naturalWidth > 0),
      );
    assert.ok(icons.every(Boolean), "All provider assets load");
    const muted = page.locator(
      '.rah-runtime-settings-card[data-supported="false"]',
    );
    assert.equal(await muted.count(), 2);
    assert.equal(
      await muted.first().evaluate((n) => getComputedStyle(n).filter),
      "grayscale(1)",
    );
    const codex = page.getByRole("checkbox", {
      name: "Codex Guide",
      exact: true,
    });
    await codex.waitFor();
    assert.equal(await codex.isChecked(), false);
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Kimi Guide", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await page
        .getByRole("checkbox", { name: "OpenCode Guide", exact: true })
        .isDisabled(),
      true,
    );
    await codex.click();
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="Codex Guide"]')?.checked,
    );
    assert.equal(await codex.isChecked(), true);
    assert.equal(
      await page
        .getByRole("checkbox", { name: "Claude Code Guide", exact: true })
        .isChecked(),
      false,
    );
    await codex.focus();
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () => !document.querySelector('input[aria-label="Codex Guide"]').checked,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `/tmp/rah-guide-${viewport.width}.png`,
      fullPage: true,
    });
    await page.close();
  }
  console.log(
    "Guide settings: pointer, keyboard, disabled capabilities, independent values, desktop/mobile passed.",
  );
} finally {
  await browser.close();
  await server.close();
}
