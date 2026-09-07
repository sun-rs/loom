import assert from "node:assert/strict";
import { join } from "node:path";

// Read-only production smoke. Canonical role mutations belong to disposable gates.
export async function verifyFormalHumanProfile(page, origin, output, engine) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/?surface=agents`, { waitUntil: "load" });
  await page.locator(".rah-agent-human-section button").first().click();
  const panel = page.getByRole("region", { name: "Human 详情" });
  await panel.getByText("加入时间", { exact: true }).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    assert.equal(
      (await panel.locator(".rah-panel-header").boundingBox()).height,
      62,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      width,
    );
    await page.screenshot({
      path: join(output, `${engine}-formal-human-${width}.png`),
    });
    const url = page.url();
    await page.reload({ waitUntil: "load" });
    await panel.getByText("加入时间", { exact: true }).waitFor();
    assert.equal(page.url(), url);
  }
}
