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
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text) => {
            window.diagnosticClipboard = text;
          },
        },
      });
    });
    await page.goto(
      server.resolvedUrls.local[0] +
        "test/scroll-ownership.html?activityRepair",
      { waitUntil: "networkidle" },
    );
    const scroll = page.locator(".rah-agent-activity-pane");
    const diagnostics = page.locator(".rah-agent-activity-surface > header");
    await expect(diagnostics).toHaveCSS("border-bottom-width", "2px");
    await expect(diagnostics.locator("h3")).toHaveCSS(
      "color",
      "rgba(0, 0, 0, 0.6)",
    );
    const copy = diagnostics.getByRole("button", { name: "复制诊断信息" });
    await expect(copy).toHaveCSS("font-size", "12px");
    await expect(copy.locator("svg")).toHaveCSS("width", "12px");
    await expect(copy.locator("use")).toHaveAttribute(
      "href",
      /#raft-icon-clipboard$/,
    );
    await copy.click();
    await expect(
      diagnostics.getByRole("button", { name: "已复制" }),
    ).toBeVisible();
    const copied = await page.evaluate(() => window.diagnosticClipboard);
    assert.match(copied, /reportedAtUtc:/);
    assert.ok(copied.split("\n").length <= 16);
    assert.doesNotMatch(copied, /producerSequence|Exported records|toolInput/);
    await expect(
      scroll.getByText("未运行的 Agent", { exact: false }),
    ).toHaveCount(0);
    assert.equal(await scroll.locator(".rah-trajectory-context").count(), 0);
    const earlier = scroll.getByRole("button", {
      name: "加载更早记录",
      exact: true,
    });
    await expect(earlier).toHaveCount(0);
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
    await page
      .getByRole("button", { name: "Scroll and append diagnostic" })
      .click();
    await expect(latest).toBeVisible();
    await latest.click();
    await expect(latest).toHaveCount(0);
    await expect(
      scroll.locator(".rah-agent-activity-list article"),
    ).toHaveCount(81);
    await page.screenshot({ path: `/tmp/rah-activity-repair-${width}.png` });
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
