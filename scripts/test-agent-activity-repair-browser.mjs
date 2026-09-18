import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, webkit, expect } from "playwright/test";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await (
  process.env.RAH_BROWSER === "webkit" ? webkit : chromium
).launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    await page.goto(
      server.resolvedUrls.local[0] +
        "test/scroll-ownership.html?activityRepair",
      { waitUntil: "networkidle" },
    );
    const scroll = page.locator(".rah-agent-activity-pane");
    assert.equal(await scroll.locator(".rah-trajectory-context").count(), 0);
    const earlier = scroll.getByRole("button", {
      name: "加载更早记录",
      exact: true,
    });
    assert.ok(
      await earlier.evaluate(
        (e) =>
          e.getBoundingClientRect().bottom <=
          e.parentElement
            .querySelector(".rah-agent-activity-list")
            .getBoundingClientRect().top,
      ),
    );
    assert.ok(await scroll.evaluate((e) => e.scrollTop > 100));
    const latest = page.getByRole("button", { name: "回到底部", exact: true });
    await expect(latest).toHaveCount(0);
    await scroll.evaluate((e) => {
      e.scrollTop = 0;
    });
    await expect(latest).toBeVisible();
    await page.screenshot({
      path: `/tmp/rah-activity-bottom-${process.env.RAH_BROWSER ?? "chromium"}-${width}.png`,
    });
    await latest.click();
    await expect(latest).toHaveCount(0);
    await expect(
      scroll.locator(".rah-agent-activity-list article"),
    ).toHaveCount(80);
    assert.ok(
      await scroll.evaluate(
        (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 2,
      ),
    );
    await scroll.evaluate((e) => {
      e.scrollTop = 0;
    });
    await earlier.click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(".rah-agent-activity-list article").length ===
        100,
    );
    assert.ok(
      await scroll.evaluate((e) => e.scrollTop > 100),
      "prepend retains reading anchor instead of jumping to new oldest",
    );
    await expect(latest).toBeVisible();
    await latest.click();
    await expect(latest).toHaveCount(0);
    await expect(
      scroll.locator(".rah-agent-activity-list article"),
    ).toHaveCount(80);
    await page.screenshot({ path: `/tmp/rah-activity-repair-${width}.png` });
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
