import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "standalone", { value: true }),
  );
  await page.goto(`${fixture.origin}/?surface=search&q=FAKE`);
  const bar = page.getByRole("region", { name: "搜索筛选" });
  await expect(
    bar.getByRole("button", { name: "发送者", exact: true }),
  ).toBeVisible();
  await expect(bar).toHaveCSS("flex-wrap", "nowrap");
  assert.equal(
    await bar.evaluate((el) => el.scrollWidth > el.clientWidth),
    true,
  );
  const firstY = (await bar.locator("button").first().boundingBox()).y;
  const sort = bar
    .locator(".rah-discovery-filter")
    .last()
    .getByRole("button")
    .first();
  await sort.scrollIntoViewIfNeeded();
  assert.ok(await bar.evaluate((el) => el.scrollLeft > 0));
  assert.equal(Math.round((await sort.boundingBox()).y), Math.round(firstY));
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await sort.tap();
  await page.getByRole("menuitemradio", { name: "最新", exact: true }).tap();
  await expect(sort).toContainText("最新");
  await expect(page).toHaveURL(/sort=recent/);
  await page.screenshot({
    path: `/tmp/search-filter-scroll-${process.env.RAH_BROWSER ?? "chromium"}.png`,
  });
  await page.reload();
  await expect(bar).toHaveCSS("flex-wrap", "nowrap");
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(bar).toHaveCSS("overflow-x", "visible");
  const desktop = await browser.newPage({
    viewport: { width: 600, height: 844 },
  });
  await desktop.goto(`${fixture.origin}/?surface=search&q=FAKE`);
  const desktopBar = desktop.getByRole("region", { name: "搜索筛选" });
  for (const width of [600, 390, 1440, 600]) {
    await desktop.setViewportSize({ width, height: 844 });
    await expect(desktopBar).toHaveCSS("flex-wrap", "wrap");
    await expect(desktopBar).toHaveCSS("overflow-x", "visible");
    const layout = await desktopBar.evaluate((el) => ({
      width: el.clientWidth,
      scroll: el.scrollWidth,
      rows: new Set(
        [...el.children].map((child) => child.getBoundingClientRect().top),
      ).size,
    }));
    assert.ok(layout.scroll <= layout.width);
    if (width === 390) assert.ok(layout.rows > 1);
  }
  await desktop.reload();
  await expect(desktopBar).toHaveCSS("flex-wrap", "wrap");
  await desktop.screenshot({
    path: `/tmp/search-filter-desktop-${process.env.RAH_BROWSER ?? "chromium"}.png`,
  });
  await desktop.close();
  console.log(
    "PASS mobile single-row scroll, last filter selection, reload and desktop layout",
  );
} finally {
  await browser.close();
  await fixture.close();
}
