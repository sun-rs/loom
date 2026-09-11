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
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(
      server.resolvedUrls.local[0] +
        "test/runtime-guide-fixture.html?settingsSection=administration",
    );
    await page
      .locator("main")
      .first()
      .evaluate((n) => n.classList.add("rah-product-shell"));
    const card = page.locator(".rah-runtime-settings-card").first(),
      heading = card.locator("summary");
    await heading.waitFor();
    const style = async (n) =>
      n.evaluate((e) => {
        const s = getComputedStyle(e);
        return {
          border: s.borderColor,
          shadow: s.boxShadow,
          transform: s.transform,
          bg: s.backgroundColor,
          width: e.getBoundingClientRect().width,
        };
      });
    const rest = await style(card);
    assert.ok(["rgb(0, 0, 0)", "oklch(0 0 0)"].includes(rest.border));
    await heading.hover();
    await page.waitForTimeout(200);
    assert.notEqual((await style(card)).shadow, rest.shadow);
    assert.equal((await style(card)).width, rest.width);
    await heading.click();
    assert.equal(await card.locator("details").getAttribute("open"), "");
    assert.notEqual((await style(heading)).bg, "rgb(255, 212, 64)");
    await heading.click();
    assert.notEqual((await style(heading)).bg, "rgb(255, 212, 64)");
    await page.goto(
      server.resolvedUrls.local[0] +
        "test/runtime-guide-fixture.html?settingsSection=appearance",
    );
    await page
      .locator("main")
      .first()
      .evaluate((n) => n.classList.add("rah-product-shell"));
    const small = page.getByRole("button", { name: "小", exact: true });
    await small.waitFor();
    await page.mouse.move(0, 0);
    const before = await style(small);
    await small.hover();
    await page.waitForTimeout(200);
    const after = await style(small);
    for (const k of ["border", "shadow", "transform", "width"])
      assert.equal(after[k], before[k], k);
    assert.notEqual(after.bg, before.bg);
    await small.click();
    assert.equal(await small.getAttribute("aria-pressed"), "true");
    await page.close();
  }
  console.log(
    "Settings hover: desktop/mobile card disclosure and stationary font-size controls passed",
  );
} finally {
  await browser.close();
  await server.close();
}
