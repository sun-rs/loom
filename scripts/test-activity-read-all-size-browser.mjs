import assert from "node:assert/strict";
import { chromium, firefox, expect } from "playwright/test";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const fixture = await startShellFixture();
const engine = process.env.RAH_TEST_ENGINE ?? "chrome";
const browser = await (engine === "firefox" ? firefox : chromium).launch({
  headless: true,
  ...(engine === "chrome"
    ? { executablePath: await findChromeExecutable() }
    : {}),
});
try {
  const page = await browser.newPage();
  await page.goto(fixture.origin + "/?surface=activity");
  const button = page.locator(".rah-activity-read-all");
  await page.locator(".feed-card").first().waitFor();
  assert.equal(
    await page.locator(".rah-unfollow").count(),
    0,
    "done control has no extra unfollow label",
  );
  await button.waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const card = page.locator(".feed-card").first();
    const geometry = await card.evaluate((e) => {
      const time = e.querySelector("time");
      const heading = time.parentElement;
      const r = e.getBoundingClientRect(),
        t = time.getBoundingClientRect();
      return {
        rightGap: r.right - t.right,
        headingDisplay: getComputedStyle(heading).display,
      };
    });
    assert.deepEqual(
      geometry,
      { rightGap: 14, headingDisplay: "flex" },
      `Raft latest timestamp ends at the card padding at ${width}px`,
    );
    const time = card.locator("time");
    const action = card.locator(".activity-done");
    await expect(time).toHaveCSS("transition-duration", "0.15s");
    await expect(time).toHaveCSS(
      "transition-timing-function",
      "cubic-bezier(0.4, 0, 0.2, 1)",
    );
    await expect(action).toHaveCSS("transition-duration", "0.1s");
    const snapshot = await card.boundingBox();
    await page.mouse.move(0, 0);
    await expect(time).toHaveCSS("opacity", "1");
    await expect(action).toHaveCSS("opacity", "0");
    await expect(action).toHaveCSS("pointer-events", "none");
    const rect = await card.boundingBox();
    await page.mouse.move(rect.x + 24, rect.y + 24);
    await expect(time).toHaveCSS("opacity", "0");
    await expect(action).toHaveCSS("opacity", "1");
    await expect(action).toHaveCSS("pointer-events", "auto");
    assert.equal((await action.boundingBox()).x + 30, rect.x + rect.width - 14);
    assert.deepEqual(
      await card.boundingBox(),
      snapshot,
      "hover does not reflow the card",
    );
    await page.mouse.move(0, 0);
    await expect(time).toHaveCSS("opacity", "1");
    await expect(action).toHaveCSS("opacity", "0");
    await card.locator(".rah-activity-open").focus();
    await page.keyboard.press("Tab");
    await expect(action).toBeFocused();
    await expect(time).toHaveCSS("opacity", "0");
    await expect(action).toHaveCSS("opacity", "1");
    await page.keyboard.press("Tab");
    await expect(time).toHaveCSS("opacity", "1");
    await expect(action).toHaveCSS("opacity", "0");
    await page.screenshot({
      path: `/tmp/activity-swap-${engine}-${width}.png`,
    });
    assert.deepEqual(
      await button.evaluate((e) => {
        const s = getComputedStyle(e);
        return {
          height: e.getBoundingClientRect().height,
          font: s.fontSize,
          padding: s.paddingLeft,
          line: s.lineHeight,
        };
      }),
      { height: 32, font: "12px", padding: "8px", line: "16px" },
    );
  }
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const touchPage = await touch.newPage();
  await touchPage.goto(fixture.origin + "/?surface=activity");
  const touchCard = touchPage.locator(".feed-card").first();
  await expect(touchCard.locator("time")).toHaveCSS("opacity", "0");
  await expect(touchCard.locator(".activity-done")).toHaveCSS("opacity", "1");
  await expect(touchCard.locator(".activity-done")).toHaveCSS(
    "pointer-events",
    "auto",
  );
  await touch.close();
  console.log(
    `${engine}: Activity timestamp/action replacement, hover exit, keyboard, touch and mark-all-read size passed`,
  );
} finally {
  await browser.close();
  await fixture.close();
}
