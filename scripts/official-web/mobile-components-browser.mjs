// Read-only size contract on a populated deployment. Does not send CLI work.
// Requires existing tasks; empty data cannot establish card acceptance.
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
const browser = await (
  process.env.LOOM_BROWSER_ENGINE === "webkit" ? webkit : chromium
).launch();
const origin = process.env.LOOM_BROWSER_ORIGIN || "http://127.0.0.1:4176";
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: 844 },
      deviceScaleFactor: 1,
    });
    await page.goto(origin + "/?view=tasks");
    const card = page.locator('[data-slot="task-card"]').first();
    await card.waitFor();
    const metrics = await card.evaluate((el) => {
      const style = (slot) => {
        const s = getComputedStyle(el.querySelector(`[data-slot="${slot}"]`));
        return [s.fontSize, s.lineHeight];
      };
      return {
        padding: getComputedStyle(el).padding,
        title: style("task-card-title"),
        description: style("task-card-description"),
        border: getComputedStyle(el).borderTopWidth,
      };
    });
    assert.deepEqual(
      metrics.title,
      width < 768 ? ["14px", "20px"] : ["16px", "24px"],
    );
    assert.deepEqual(
      metrics.description,
      width < 768 ? ["12px", "16px"] : ["14px", "20px"],
    );
    assert.equal(metrics.padding, width < 768 ? "10px 12px" : "12px");
    assert.equal(metrics.border, "1px");
    console.log(JSON.stringify({ width, metrics }));
    await page.goto(origin + "/?view=agents");
    const role = page.locator("[data-role-id]").first();
    await role.waitFor();
    assert.equal((await role.boundingBox()).height, width < 768 ? 34 : 36);
    assert.equal(
      await role
        .locator('[data-slot="avatar"]')
        .first()
        .evaluate((el) => el.getBoundingClientRect().width),
      width < 768 ? 18 : 16,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
