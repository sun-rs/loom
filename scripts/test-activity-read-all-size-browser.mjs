import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startShellFixture } from "./ui-shell-browser-scenarios.mjs";
import { findChromeExecutable } from "./real-browser-gate-support.mjs";
const fixture = await startShellFixture();
const browser = await chromium.launch({
  headless: true,
  executablePath: await findChromeExecutable(),
});
try {
  const page = await browser.newPage();
  await page.goto(fixture.origin + "/?surface=activity");
  const button = page.locator(".rah-activity-read-all");
  await button.waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
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
  console.log(
    "Activity mark-all-read source geometry passed at desktop and mobile",
  );
} finally {
  await browser.close();
  await fixture.close();
}
