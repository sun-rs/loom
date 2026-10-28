import assert from "node:assert/strict";
// System Channels are upstream-only. Loom's management page must not revive them.
export async function verifySystemSettings({ browser, origin }) {
  const results = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height: 844 },
    });
    try {
      const page = await context.newPage(),
        calls = [];
      page.on("request", (r) => {
        if (r.url().includes("/system-channel/")) calls.push(r.url());
      });
      await page.goto(origin + "/?view=settings&settings=administration", {
        waitUntil: "networkidle",
      });
      assert.equal(
        await page.getByText("系统频道", { exact: true }).count(),
        0,
      );
      assert.deepEqual(calls, []);
      results.push({ width, systemChannelSettingsAbsent: true });
    } finally {
      await context.close();
    }
  }
  return results;
}
