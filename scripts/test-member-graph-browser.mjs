import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const server = await createServer({
  root: new URL("../apps/web", import.meta.url).pathname,
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
try {
  const page = await browser.newPage();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(server.resolvedUrls.local[0] + "test/member-graph.html");
    const avatars = page.locator(
      '.rah-member-graph-node-trigger > [role="img"]',
    );
    await avatars.first().waitFor();
    assert.equal(await avatars.count(), 2);
    const avatarAppearance = (node) => ({
      background: getComputedStyle(node).backgroundColor,
      pixels: [...node.querySelectorAll(".rah-agent-avatar-grid i")].map(
        (pixel) => [
          pixel.style.gridColumn,
          pixel.style.gridRow,
          getComputedStyle(pixel).backgroundColor,
        ],
      ),
    });
    assert.deepEqual(
      await page
        .locator(".rah-member-graph-node-trigger > .rah-agent-avatar")
        .evaluate(avatarAppearance),
      await page
        .locator('[data-testid="canonical-avatar"] > .rah-agent-avatar')
        .evaluate(avatarAppearance),
      "graph preserves the canonical Agent avatar palette and pixels",
    );
    for (const selector of [
      ".rah-member-graph-page-header .rah-panel-header-icon",
      ".rah-member-graph-header > div",
    ]) {
      assert.match(
        await page.locator(`${selector} use`).getAttribute("href"),
        /#raft-icon-git-branch$/,
      );
    }
    const geometry = await avatars.evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return [box.width, box.height, getComputedStyle(node).borderRadius];
      }),
    );
    assert.deepEqual(geometry, [
      [36, 36, "50%"],
      [36, 36, "50%"],
    ]);
    assert.equal(
      await page.locator(".rah-member-graph-page-header").innerText(),
      "关系图\nEXPERIMENTAL",
    );
    assert.equal(
      await page
        .locator(".rah-member-graph-header")
        .getByText("2", { exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    console.log({ width, geometry });
    await page.screenshot({ path: `/tmp/rah-member-graph-${width}.png` });
  }
} finally {
  await browser.close();
  await server.close();
}
