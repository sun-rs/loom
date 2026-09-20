import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_UI_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(`${fixture.origin}/?surface=tasks`);
  await page.locator(".rah-global-card-open").first().click();
  const meta = page.getByTestId("task-detail-metadata");
  await expect(meta).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(async () => {
      const groups = await meta.locator("dt").evaluateAll((es) =>
        es.map((e) => {
          const a = e.getBoundingClientRect(),
            b = e.nextElementSibling.getBoundingClientRect();
          return {
            label: e.textContent,
            ay: a.y,
            by: b.y,
            ah: a.height,
            bh: b.height,
            ax: a.x,
            bx: b.x,
          };
        }),
      );
      for (const g of groups) {
        assert.ok(
          Math.abs(g.ay + g.ah / 2 - g.by - g.bh / 2) < 2,
          `${width}: ${g.label} must align horizontally with its value`,
        );
        assert.ok(g.bx > g.ax);
      }
    }).toPass({ timeout: 3000 });
    await page.screenshot({
      path: `/tmp/rah-task-property-${process.env.RAH_UI_BROWSER ?? "chromium"}-${width}.png`,
    });
  }
  console.log(
    "PASS status/assignee/creator label-value pairs stay horizontal at 1440/390/320",
  );
} finally {
  await browser.close();
  await fixture.close();
}
