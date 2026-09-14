import assert from "node:assert/strict";
import { chromium, webkit, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";

const fixture = await startShellFixture();
const browser = await (
  process.env.RAH_MOBILE_ENGINE === "webkit" ? webkit : chromium
).launch();
try {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(`${fixture.origin}/?surface=room&room=${fixture.roomId}`);
  const sidebar = page.locator(".rah-room-sidebar");
  const back = page.getByRole("button", { name: "返回主页", exact: true });
  const room = sidebar
    .locator(`[data-sidebar-key="room:${fixture.roomId}"] button`)
    .first();
  for (const kind of ["room", "dm", "room"]) {
    if (
      kind !== "room" ||
      (await sidebar.getAttribute("class")).includes("is-open")
    ) {
      const row =
        kind === "dm"
          ? sidebar
              .locator('[data-sidebar-group="dms"] [data-sidebar-key] button')
              .first()
          : room;
      await row.tap();
    }
    await expect(back).toBeVisible();
    // Let the hidden row settle before recording the entire return animation.
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      window.__returnFrames = [];
      window.__sampleReturn = true;
      const sample = () => {
        const sidebar = document.querySelector(".rah-room-sidebar");
        if (getComputedStyle(sidebar).visibility === "visible") {
          window.__returnFrames.push(
            [...sidebar.querySelectorAll(".channel-row")].map(
              (row) => getComputedStyle(row).backgroundColor,
            ),
          );
        }
        if (window.__sampleReturn) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await back.tap();
    await page.waitForTimeout(250);
    const frames = await page.evaluate(() => {
      window.__sampleReturn = false;
      return window.__returnFrames;
    });
    assert.ok(
      frames.length >= 3,
      "record visible animation frames, not only the settled class",
    );
    const pink = frames.flat().filter((color) => {
      const [r, g, b, a = 1] = color.match(/[\d.]+/g).map(Number);
      return a > 0.001 && r > g + 5 && b > g + 5;
    });
    assert.deepEqual(
      pink,
      [],
      `${kind}: returning to the mobile list must never paint a pink frame`,
    );
    await expect(sidebar.locator(".channel-row.is-selected")).toHaveCount(0);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sidebar.locator(".channel-row.is-selected")).toHaveCount(1);
  console.log("PASS mobile Room/DM return frames and desktop selection");
} finally {
  await browser.close();
  await fixture.close();
}
