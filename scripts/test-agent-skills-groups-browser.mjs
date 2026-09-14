import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium, firefox } from "playwright";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
try {
  for (const [name, engine] of [
    ["chrome", chromium],
    ["firefox", firefox],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const width of [1440, 390]) {
        const page = await browser.newPage({
          viewport: { width, height: width === 390 ? 844 : 900 },
        });
        await page.goto(
          server.resolvedUrls.local[0] +
            "test/agent-skills-groups-fixture.html",
        );
        const sources = page.locator(".rah-agent-skills-source");
        await sources.first().waitFor();
        assert.deepEqual(await sources.locator("code").allTextContents(), [
          "~/skills",
          "~/skills/.system",
        ]);
        assert.equal(
          await sources.locator("code").first().getAttribute("title"),
          "~/.codex/skills",
        );
        await page
          .getByText("此 Agent 工作区内暂无 skill", { exact: true })
          .waitFor();
        const label = sources.locator("code").first();
        const appearance = () =>
          label.evaluate((e) => {
            const s = getComputedStyle(e);
            return {
              background: s.backgroundColor,
              border: s.borderTopWidth,
              font: s.fontSize,
              padding: s.paddingLeft,
            };
          });
        const rest = await appearance();
        assert.equal(rest.border, "1px");
        assert.equal(rest.font, "11px");
        assert.equal(rest.padding, "6px");
        assert.match(rest.background, /0\.5\)|50%/); // Raft yellow at 50% opacity, visible at rest.
        await label.hover();
        assert.deepEqual(await appearance(), rest);
        await page.mouse.move(0, 0);
        assert.deepEqual(await appearance(), rest);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: `/tmp/rah-skills-groups-${name}-${width}.png`,
        });
        await page.close();
      }
      console.log(
        name,
        "desktop/mobile directory labels, source paths, default/hover/exit and empty text passed",
      );
    } finally {
      await browser.close();
    }
  }
} finally {
  await server.close();
}
